/**
 * PYAM Executive Hangar Status Tracker
 * 
 * MIT License
 * 
 * Copyright (c) 2025 Xyxyll
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 * @version 2.2.32
 * @description Tracks and displays PYAM hangar online/offline status for Star Citizen.
 * @lastModified 2026-Oct-29
 */

const CYCLE_DRIFT_MS = 350;

const DESIGN_ONLINE_MIN  = 65;
const DESIGN_OFFLINE_MIN = 120;
const DESIGN_CYCLE_MIN   = DESIGN_ONLINE_MIN + DESIGN_OFFLINE_MIN;
const DESIGN_ONLINE_MS   = DESIGN_ONLINE_MIN  * 60 * 1000;
const DESIGN_OFFLINE_MS  = DESIGN_OFFLINE_MIN * 60 * 1000;
const DESIGN_CYCLE_MS    = DESIGN_CYCLE_MIN   * 60 * 1000;

const CYCLE_DURATION = DESIGN_CYCLE_MS + CYCLE_DRIFT_MS;
const OPEN_DURATION  = Math.round(CYCLE_DURATION * DESIGN_ONLINE_MS / DESIGN_CYCLE_MS);
const CLOSE_DURATION = CYCLE_DURATION - OPEN_DURATION;

const INITIAL_OPEN_TIME = new Date('2026-10-29T18:01:09.073-04:00');

function getNextStatusChange(currentTime) {
    let elapsedTimeSinceInitialOpen = (currentTime - INITIAL_OPEN_TIME);
    let timeInCurrentCycle = elapsedTimeSinceInitialOpen % CYCLE_DURATION;

    if (timeInCurrentCycle < OPEN_DURATION) {
        // hangars are online
        document.title = "PYAM Is Online";
        return {
            status: 'ONLINE',
            nextChangeTime: new Date(currentTime.getTime() + (OPEN_DURATION - timeInCurrentCycle))
        };
    } else {
        // hangars are offline
        let remainingCloseDuration = timeInCurrentCycle - OPEN_DURATION;
        document.title = "PYAM Is Offline";
        return {
            status: 'OFFLINE',
            nextChangeTime: new Date(currentTime.getTime() + (CLOSE_DURATION - remainingCloseDuration))
        };
    }
}

const thresholds = [
    ...[
        { until: 12/65, colors: ['green', 'green', 'green', 'green', 'green'] },
        { until: 24/65, colors: ['green', 'green', 'green', 'green', 'empty'] },
        { until: 36/65, colors: ['green', 'green', 'green', 'empty', 'empty'] },
        { until: 48/65, colors: ['green', 'green', 'empty', 'empty', 'empty'] },
        { until: 60/65, colors: ['green', 'empty', 'empty', 'empty', 'empty'] },
        { until: 1,     colors: ['empty', 'empty', 'empty', 'empty', 'empty'] },
    ].map((z, i, a) => ({
        min: (i === 0 ? 0 : a[i - 1].until) * OPEN_DURATION,
        max: z.until * OPEN_DURATION,
        colors: z.colors,
    })),
    ...[
        { until: 1/5, colors: ['red',   'red',   'red',   'red', 'red'] },
        { until: 2/5, colors: ['green', 'red',   'red',   'red', 'red'] },
        { until: 3/5, colors: ['green', 'green', 'red',   'red', 'red'] },
        { until: 4/5, colors: ['green', 'green', 'green', 'red', 'red'] },
        { until: 1,   colors: ['green', 'green', 'green', 'green', 'red'] },
    ].map((z, i, a) => ({
        min: OPEN_DURATION + (i === 0 ? 0 : a[i - 1].until) * CLOSE_DURATION,
        max: OPEN_DURATION + z.until * CLOSE_DURATION,
        colors: z.colors,
    })),
];

function updateStatusAndCountdown() {
    const now = new Date();
    const { status, nextChangeTime } = getNextStatusChange(now);

    document.getElementById('status').textContent = status;

    function formatTime(ms) {
        let minutes = Math.floor(ms / 1000 / 60);
        let seconds = Math.floor((ms / 1000) % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function updateCountdownAndCircles() {
        const updatedDate = new Date();
        const remainingTime = nextChangeTime - updatedDate;
        const timeInCycle = (updatedDate - INITIAL_OPEN_TIME) % CYCLE_DURATION;
        if (remainingTime <= 0) {
            // Update status and countdown to the next event
            if (cleanupInterval) cleanupInterval();
            cleanupInterval = updateStatusAndCountdown();
            generateScheduleTable();
        } else {
            document.getElementById('countdown').textContent = formatTime(remainingTime);
        }
        // Now for the circles
        // Find which threshold we're in
        const current = thresholds.find(t => timeInCycle >= t.min && timeInCycle < t.max);
        // Update each circle color
        if (current) {
            cachedCircles.forEach((circle, index) => {
                if (current.colors[index] === 'green') {
                    circle.style.backgroundColor = '#4CAF50';
                } else if (current.colors[index] === 'red') {
                    circle.style.backgroundColor = '#f44336';
                } else {
                    circle.style.backgroundColor = 'transparent';
                }
            });
        }
    }

    updateCountdownAndCircles();
    const intervalId = setInterval(function () {
        updateCountdownAndCircles();
    }, 1000);

    // Return cleanup function
    return function cleanup() {
        clearInterval(intervalId);
    };
}

function generateScheduleTable() {
    let scheduleBody = document.getElementById('schedule');
    let currentTime = new Date();

    // Clear existing rows
    scheduleBody.innerHTML = '';

    // Find the next event (either online or offline) from the current time
    const { status, nextChangeTime } = getNextStatusChange(currentTime);
    let nextEventTime = nextChangeTime;
    let currentStatus = status;

    // We'll build an array of events first, then render with cycle logic
    let events = [];
    let firstEventType = null;
    let firstEventTime = null;
    let tempTime = currentTime;
    let tempStatus = currentStatus;
    let tempNextEventTime = nextEventTime;

    // Determine the first event type and time
    if (tempStatus === 'ONLINE') {
        // First event is offline (end of current cycle)
        events.push({ type: 'Offline', time: tempNextEventTime, statusClass: 'status-offline' });
        tempTime = new Date(tempNextEventTime.getTime() + CLOSE_DURATION);
        tempStatus = 'OFFLINE';
        firstEventType = 'Offline';
        firstEventTime = tempNextEventTime;
    } else {
        // First event is online (mid-cycle)
        events.push({ type: 'Online', time: tempNextEventTime, statusClass: 'status-online' });
        tempTime = new Date(tempNextEventTime.getTime() + OPEN_DURATION);
        tempStatus = 'ONLINE';
        firstEventType = 'Online';
        firstEventTime = tempNextEventTime;
    }

    // Generate subsequent schedule events for the next three days
    let endTime = new Date(tempTime.getTime() + 24 * 3 * 60 * 60 * 1000); // 24 hours * 3 days from now
    while (tempTime < endTime) {
        if (tempStatus === 'ONLINE') {
            // Add offline event
            events.push({ type: 'Offline', time: tempTime, statusClass: 'status-offline' });
            tempTime = new Date(tempTime.getTime() + CLOSE_DURATION);
            tempStatus = 'OFFLINE';
        } else {
            // Add online event
            events.push({ type: 'Online', time: tempTime, statusClass: 'status-online' });
            tempTime = new Date(tempTime.getTime() + OPEN_DURATION);
            tempStatus = 'ONLINE';
        }
    }

    // Calculate absolute cycle numbers based on INITIAL_OPEN_TIME.
    // INITIAL_OPEN_TIME is cycle 36 (resync 2026-05-23 from in-game observation;
    // offset lowered by 1 to account for a likely server freeze that lagged the cycle count).
    const getEventCycle = (eventTime) => {
        const elapsedTime = eventTime - INITIAL_OPEN_TIME;
        return Math.floor(elapsedTime / CYCLE_DURATION) + 159;
    };

    // Now render the table with cycle numbers and rowspan logic
    let html = '';
    let i = 0;
    while (i < events.length) {
        // If first event is Offline, it's a mid-cycle, label as Cycle 1
        if (i === 0 && events[i].type === 'Offline') {
            const currentCycle = getEventCycle(events[i].time);
            html += `<tr>`;
            html += `<td class="cycle-cell" rowspan="1">${currentCycle}</td>`;
            html += `<td class="${events[i].statusClass}">${events[i].type}</td>`;
            html += `<td>${events[i].time.toLocaleString()}</td>`;
            html += `</tr>`;
            i++;
            continue;
        }
        // If first event is Online, pair with next Offline for a cycle
        if (i + 1 < events.length && events[i].type === 'Online' && events[i+1].type === 'Offline') {
            const currentCycle = getEventCycle(events[i+1].time);
            html += `<tr>`;
            html += `<td class="cycle-cell" rowspan="2">${currentCycle}</td>`;
            html += `<td class="${events[i].statusClass}">${events[i].type}</td>`;
            html += `<td>${events[i].time.toLocaleString()}</td>`;
            html += `</tr>`;
            html += `<tr>`;
            html += `<td class="${events[i+1].statusClass}">${events[i+1].type}</td>`;
            html += `<td>${events[i+1].time.toLocaleString()}</td>`;
            html += `</tr>`;
            i += 2;
            continue;
        }
        // If event is Online but next is not Offline (shouldn't happen, but fallback)
        if (events[i].type === 'Online') {
            const currentCycle = getEventCycle(events[i].time);
            html += `<tr>`;
            html += `<td class="cycle-cell" rowspan="1">${currentCycle}</td>`;
            html += `<td class="${events[i].statusClass}">${events[i].type}</td>`;
            html += `<td>${events[i].time.toLocaleString()}</td>`;
            html += `</tr>`;
            i++;
            continue;
        }
        // If event is Offline and not first row (shouldn't happen, but fallback)
        if (events[i].type === 'Offline') {
            const currentCycle = getEventCycle(events[i].time);
            html += `<tr>`;
            html += `<td class="cycle-cell" rowspan="1">${currentCycle}</td>`;
            html += `<td class="${events[i].statusClass}">${events[i].type}</td>`;
            html += `<td>${events[i].time.toLocaleString()}</td>`;
            html += `</tr>`;
            i++;
            continue;
        }
    }
    // Add single header row with 'Local Time' and only once
    scheduleBody.innerHTML = `<tr><th>Cycle</th><th>Status</th><th>Local Time</th></tr>` + html;
}

// Store interval cleanup function
let cleanupInterval;

// Store DOM elements to avoid repeated queries
let cachedCircles;

// Hide the status-update toast after this date (7 days from 2026-05-23)
const TOAST_CUTOFF = new Date('2026-11-01T00:00:00-04:00');

function showLaunchToast() {
    if (new Date() >= TOAST_CUTOFF) return;
    const toastEl = document.getElementById('launchToast');
    if (!toastEl) return;

    toastEl.classList.add('show');

    const hide = () => toastEl.classList.remove('show');
    const autoHideId = setTimeout(hide, 20000);

    const closeBtn = toastEl.querySelector('.btn-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            clearTimeout(autoHideId);
            hide();
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Cache circle elements
    cachedCircles = [
        document.getElementById('circle-1'),
        document.getElementById('circle-2'),
        document.getElementById('circle-3'),
        document.getElementById('circle-4'),
        document.getElementById('circle-5')
    ];

    if (cleanupInterval) cleanupInterval();
    cleanupInterval = updateStatusAndCountdown();
    generateScheduleTable();
    showLaunchToast();
});































