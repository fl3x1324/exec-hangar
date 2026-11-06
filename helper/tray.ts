/**
 * Minimal Windows tray integration for the helper, via Bun FFI (no extra binaries):
 * notification-area icon with tooltip, right-click menu, balloon notifications,
 * message boxes, a single-instance lock and procedurally drawn icons.
 *
 * Everything here is a no-op on non-Windows platforms so `bun helper/main.ts`
 * still runs in a terminal during development.
 */
import { dlopen, FFIType, JSCallback, ptr, type Pointer } from 'bun:ffi'

export const isWindows = process.platform === 'win32'

export type MenuItem =
  | { separator: true }
  | { label: string; onClick?: () => void; checked?: boolean; disabled?: boolean }

export type TrayColor = 'green' | 'amber' | 'red' | 'grey'

export type Tray = {
  /** Update icon colour and hover tooltip (max ~127 chars). */
  set(color: TrayColor, tooltip: string): void
  /** Balloon / toast notification. */
  notify(title: string, text: string, kind?: 'info' | 'warning' | 'error'): void
  dispose(): void
}

// ---------- Win32 bindings ----------

const { ptr: P, u32, i32, u16, i64_fast, u64_fast } = FFIType

const lib = isWindows
  ? {
      user32: dlopen('user32.dll', {
        RegisterClassExW: { args: [P], returns: u16 },
        CreateWindowExW: { args: [u32, P, P, u32, i32, i32, i32, i32, P, P, P, P], returns: P },
        DestroyWindow: { args: [P], returns: i32 },
        DefWindowProcW: { args: [P, u32, u64_fast, i64_fast], returns: i64_fast },
        PeekMessageW: { args: [P, P, u32, u32, u32], returns: i32 },
        TranslateMessage: { args: [P], returns: i32 },
        DispatchMessageW: { args: [P], returns: i64_fast },
        PostMessageW: { args: [P, u32, u64_fast, i64_fast], returns: i32 },
        RegisterWindowMessageW: { args: [P], returns: u32 },
        CreatePopupMenu: { args: [], returns: P },
        AppendMenuW: { args: [P, u32, u64_fast, P], returns: i32 },
        TrackPopupMenu: { args: [P, u32, i32, i32, i32, P, P], returns: i32 },
        DestroyMenu: { args: [P], returns: i32 },
        GetCursorPos: { args: [P], returns: i32 },
        SetForegroundWindow: { args: [P], returns: i32 },
        GetSystemMetrics: { args: [i32], returns: i32 },
        CreateIconFromResourceEx: { args: [P, u32, i32, u32, i32, i32, u32], returns: P },
        DestroyIcon: { args: [P], returns: i32 },
        MessageBoxW: { args: [P, P, P, u32], returns: i32 },
      }).symbols,
      shell32: dlopen('shell32.dll', {
        Shell_NotifyIconW: { args: [u32, P], returns: i32 },
        ShellExecuteW: { args: [P, P, P, P, P, i32], returns: P },
      }).symbols,
      advapi32: dlopen('advapi32.dll', {
        RegSetKeyValueW: { args: [P, P, P, u32, P, u32], returns: i32 },
        RegDeleteKeyValueW: { args: [P, P, P], returns: i32 },
        RegGetValueW: { args: [P, P, P, u32, P, P, P], returns: i32 },
      }).symbols,
      kernel32: dlopen('kernel32.dll', {
        GetModuleHandleW: { args: [P], returns: P },
        CreateMutexW: { args: [P, i32, P], returns: P },
        OpenMutexW: { args: [u32, i32, P], returns: P },
      }).symbols,
    }
  : null

/** NUL-terminated UTF-16LE string for W APIs. */
const w = (s: string) => Buffer.from(`${s}\0`, 'utf16le')

const WM_APP_TRAY = 0x8001
const WM_LBUTTONUP = 0x0202
const WM_LBUTTONDBLCLK = 0x0203
const WM_RBUTTONUP = 0x0205
const WM_CONTEXTMENU = 0x007b
const WM_NULL = 0
const WM_CLOSE = 0x0010
const WM_ENDSESSION = 0x0016
const NIM_ADD = 0
const NIM_MODIFY = 1
const NIM_DELETE = 2
const NIF_MESSAGE = 0x1
const NIF_ICON = 0x2
const NIF_TIP = 0x4
const NIF_INFO = 0x10
const NIIF = { info: 0x1, warning: 0x2, error: 0x3 } as const
const MF_STRING = 0x0
const MF_GRAYED = 0x1
const MF_CHECKED = 0x8
const MF_SEPARATOR = 0x800
const TPM_RIGHTBUTTON = 0x2
const TPM_NONOTIFY = 0x80
const TPM_RETURNCMD = 0x100
const TPM_BOTTOMALIGN = 0x20
const SM_CXSMICON = 49
const MB_OK = 0x0
const MB_ICONERROR = 0x10
const MB_ICONWARNING = 0x30
const MB_ICONINFO = 0x40
const MB_SETFOREGROUND = 0x10000
const SYNCHRONIZE = 0x00100000

/** sizeof(NOTIFYICONDATAW) on x64, with field offsets. */
const NID = { size: 976, hWnd: 8, uID: 16, uFlags: 20, uCallbackMessage: 24, hIcon: 32, szTip: 40, szInfo: 304, szInfoTitle: 820, dwInfoFlags: 948 }

function writeWStr(buf: Buffer, offset: number, maxChars: number, s: string) {
  const b = Buffer.from(s.slice(0, maxChars - 1), 'utf16le')
  buf.fill(0, offset, offset + maxChars * 2)
  b.copy(buf, offset)
}

// ---------- icons ----------

const COLORS: Record<TrayColor, [number, number, number]> = {
  green: [52, 211, 153],
  amber: [245, 158, 11],
  red: [239, 68, 68],
  grey: [140, 145, 155],
}

type Rgba = [number, number, number, number]

/**
 * 32-bit DIB (BITMAPINFOHEADER + bottom-up BGRA + AND mask): the format both
 * CreateIconFromResourceEx and .ico files use for an icon image.
 */
export function iconDib(size: number, pixel: (x: number, y: number) => Rgba): Buffer {
  const maskRow = Math.ceil(size / 32) * 4
  const buf = Buffer.alloc(40 + size * size * 4 + maskRow * size)
  buf.writeUInt32LE(40, 0)
  buf.writeInt32LE(size, 4)
  buf.writeInt32LE(size * 2, 8) // XOR + AND halves
  buf.writeUInt16LE(1, 12)
  buf.writeUInt16LE(32, 14)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5)
      const o = 40 + ((size - 1 - y) * size + x) * 4
      buf[o] = b
      buf[o + 1] = g
      buf[o + 2] = r
      buf[o + 3] = a
    }
  }
  return buf
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Status dot: coloured disc with a dark rim, readable on light and dark taskbars. */
export function statusPixel(size: number, color: TrayColor) {
  const [r, g, b] = COLORS[color]
  const c = size / 2
  const rOuter = size * 0.46
  const rim = Math.max(1, size / 16)
  return (x: number, y: number): Rgba => {
    const d = Math.hypot(x - c, y - c)
    const alpha = clamp01(rOuter - d + 0.5)
    if (alpha <= 0) return [0, 0, 0, 0]
    const inner = clamp01(rOuter - rim - d + 0.5)
    // soft top-left highlight
    const hl = clamp01(1 - Math.hypot(x - c * 0.7, y - c * 0.6) / (size * 0.35)) * 0.35
    const mix = (v: number) => Math.round((v + (255 - v) * hl) * inner + 20 * (1 - inner))
    return [mix(r), mix(g), mix(b), Math.round(alpha * 255)]
  }
}

// ---------- public API ----------

const HKEY_CURRENT_USER = 0x80000001 as unknown as Pointer
const RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const REG_SZ = 1
const RRF_RT_REG_SZ = 0x2

/** "Start with Windows": a per-user Run entry pointing at this exe. */
export const autostart = {
  get(name: string): boolean {
    if (!lib) return false
    return lib.advapi32.RegGetValueW(HKEY_CURRENT_USER, w(RUN_KEY), w(name), RRF_RT_REG_SZ, null, null, null) === 0
  },
  set(name: string, command: string | null): boolean {
    if (!lib) return false
    if (command === null) {
      const rc = lib.advapi32.RegDeleteKeyValueW(HKEY_CURRENT_USER, w(RUN_KEY), w(name))
      return rc === 0 || rc === 2 // ERROR_FILE_NOT_FOUND: already off
    }
    const data = w(command)
    return lib.advapi32.RegSetKeyValueW(HKEY_CURRENT_USER, w(RUN_KEY), w(name), REG_SZ, data, data.length) === 0
  },
}

/** Native handle as returned by Bun FFI (pointer-sized integer). */
type Handle = Pointer | bigint

let mutexHandle: Handle | null = null
/** Native callbacks and handles that must outlive any local scope. */
const keepAlive = new Set<unknown>()

/** False if another helper instance already holds the lock. */
export function acquireSingleInstance(name: string): boolean {
  if (!lib) return true
  const n = w(`Local\\${name}`)
  if (lib.kernel32.OpenMutexW(SYNCHRONIZE, 0, n)) return false
  mutexHandle = lib.kernel32.CreateMutexW(null, 0, n)
  keepAlive.add(mutexHandle)
  return true
}

export function messageBox(title: string, text: string, kind: 'error' | 'warning' | 'info' = 'info') {
  if (!lib) return
  const icon = kind === 'error' ? MB_ICONERROR : kind === 'warning' ? MB_ICONWARNING : MB_ICONINFO
  lib.user32.MessageBoxW(null, w(text), w(title), MB_OK | icon | MB_SETFOREGROUND)
}

/** Open a URL, file or folder with its default handler. */
export function shellOpen(target: string) {
  if (!lib) return
  lib.shell32.ShellExecuteW(null, w('open'), w(target), null, null, 1)
}

export function createTray(opts: {
  title: string
  menu: () => MenuItem[]
  onClick?: () => void
  /** Windows asked us to close (taskkill, sign-out, shutdown). */
  onClose?: () => void
}): Tray {
  if (!lib) return { set() {}, notify() {}, dispose() {} }
  const { user32, shell32, kernel32 } = lib

  const hInstance = kernel32.GetModuleHandleW(null)
  const className = w('ExecHangarsHelperTray')
  const taskbarCreated = user32.RegisterWindowMessageW(w('TaskbarCreated'))
  const nid = Buffer.alloc(NID.size)
  const iconSize = user32.GetSystemMetrics(SM_CXSMICON) || 16
  const icons = new Map<TrayColor, Handle>()
  let added = false

  const iconFor = (color: TrayColor) => {
    let h = icons.get(color)
    if (!h) {
      const dib = iconDib(iconSize, statusPixel(iconSize, color))
      const created = user32.CreateIconFromResourceEx(dib, dib.length, 1, 0x00030000, iconSize, iconSize, 0)
      if (!created) throw new Error('CreateIconFromResourceEx failed')
      h = created
      icons.set(color, h)
    }
    return h
  }

  const showMenu = () => {
    const items = opts.menu()
    const hMenu = user32.CreatePopupMenu()
    items.forEach((it, i) => {
      if ('separator' in it) user32.AppendMenuW(hMenu, MF_SEPARATOR, 0, null)
      else
        user32.AppendMenuW(
          hMenu,
          MF_STRING | (it.disabled ? MF_GRAYED : 0) | (it.checked ? MF_CHECKED : 0),
          i + 1,
          w(it.label),
        )
    })
    const pt = Buffer.alloc(8)
    user32.GetCursorPos(pt)
    // Required so the menu closes when clicking elsewhere.
    user32.SetForegroundWindow(hwnd)
    const cmd = user32.TrackPopupMenu(
      hMenu,
      TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY | TPM_BOTTOMALIGN,
      pt.readInt32LE(0),
      pt.readInt32LE(4),
      0,
      hwnd,
      null,
    )
    user32.PostMessageW(hwnd, WM_NULL, 0, 0)
    user32.DestroyMenu(hMenu)
    const chosen = cmd > 0 ? items[cmd - 1] : undefined
    if (chosen && !('separator' in chosen)) chosen.onClick?.()
  }

  const wndProc = new JSCallback(
    (h: Pointer, msg: number, wParam: number, lParam: number): number => {
      if (msg === WM_APP_TRAY) {
        const ev = lParam & 0xffff
        if (ev === WM_RBUTTONUP || ev === WM_CONTEXTMENU) showMenu()
        else if (ev === WM_LBUTTONUP || ev === WM_LBUTTONDBLCLK) opts.onClick?.()
        return 0
      }
      if (msg === WM_CLOSE || (msg === WM_ENDSESSION && wParam)) {
        opts.onClose?.()
        return 0
      }
      // Explorer restarted: the icon is gone and must be re-added.
      if (msg === taskbarCreated && added) {
        shell32.Shell_NotifyIconW(NIM_ADD, nid)
        return 0
      }
      return Number(user32.DefWindowProcW(h, msg, wParam, lParam))
    },
    { args: [P, u32, u64_fast, i64_fast], returns: i64_fast },
  )
  // Windows calls this pointer for the window's lifetime; never let it be collected.
  keepAlive.add(wndProc)

  const wc = Buffer.alloc(80)
  wc.writeUInt32LE(80, 0)
  wc.writeBigUInt64LE(BigInt(wndProc.ptr!), 8)
  wc.writeBigUInt64LE(BigInt(hInstance ?? 0), 24)
  wc.writeBigUInt64LE(BigInt(ptr(className)), 64)
  user32.RegisterClassExW(wc)
  // A hidden top-level window (not message-only) so TrackPopupMenu can take focus.
  const hwnd = user32.CreateWindowExW(0, className, w(opts.title), 0, 0, 0, 0, 0, null, null, hInstance, null)
  if (!hwnd) throw new Error('CreateWindowExW failed')

  nid.writeUInt32LE(NID.size, 0)
  nid.writeBigUInt64LE(BigInt(hwnd), NID.hWnd)
  nid.writeUInt32LE(1, NID.uID)
  nid.writeUInt32LE(WM_APP_TRAY, NID.uCallbackMessage)

  // Pump this thread's window messages without blocking Bun's event loop.
  const msg = Buffer.alloc(48)
  const pump = setInterval(() => {
    while (user32.PeekMessageW(msg, null, 0, 0, 1)) {
      user32.TranslateMessage(msg)
      user32.DispatchMessageW(msg)
    }
  }, 30)

  return {
    set(color, tooltip) {
      nid.writeUInt32LE(NIF_MESSAGE | NIF_ICON | NIF_TIP, NID.uFlags)
      nid.writeBigUInt64LE(BigInt(iconFor(color)), NID.hIcon)
      writeWStr(nid, NID.szTip, 128, tooltip)
      if (!shell32.Shell_NotifyIconW(added ? NIM_MODIFY : NIM_ADD, nid)) {
        if (added) return
        throw new Error('Shell_NotifyIconW(NIM_ADD) failed')
      }
      added = true
    },
    notify(title, text, kind = 'info') {
      if (!added) return
      nid.writeUInt32LE(NIF_INFO, NID.uFlags)
      writeWStr(nid, NID.szInfoTitle, 64, title)
      writeWStr(nid, NID.szInfo, 256, text)
      nid.writeUInt32LE(NIIF[kind], NID.dwInfoFlags)
      shell32.Shell_NotifyIconW(NIM_MODIFY, nid)
    },
    dispose() {
      clearInterval(pump)
      if (added) shell32.Shell_NotifyIconW(NIM_DELETE, nid)
      added = false
      for (const h of icons.values()) user32.DestroyIcon(h as Pointer)
      user32.DestroyWindow(hwnd)
      keepAlive.delete(wndProc)
      wndProc.close()
    },
  }
}
