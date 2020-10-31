#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');
const cache = require('./cache');
const calendar = require('./calendar')
const serverChecks = require('./servers');

const FETCH_EVENTS_IN_NEXT_X_HOURS = process.env.FETCH_EVENTS_IN_NEXT_X_HOURS || 12;
const START_LED = parseInt(process.env.START_LED) || 3;
const INCREMENT_LED = parseInt(process.env.INCREMENT_LED) || 8;
const INDIVIDUAL_EVENT_COLUMN_COUNT = parseInt(process.env.INDIVIDUAL_EVENT_COLUMN_COUNT) || 3;
const MAX_PENDING_EVENTS = parseInt(process.env.MAX_PENDING_EVENTS) || 5;
const WEB_URL = process.env.WEB_URL;
const HOUR = 60 * 60;
const MINUTE = 60;
const queue = [];
let queueRunning = false;

const colors = {
    off: [0, 0, 0],
    imminentStart: [255, 0, 0],
    started: [50, 0, 0]
}

/**
 * Greater than an hour away is [0, 50, 0] green grows brighter until an hour is [0, 255, 0]
 * Less than an hour is [50, 100, 0] and red grows brighter
 * @param milliSecondsUntilEvent
 * @returns {number[]}
 */
function generateColor(milliSecondsUntilEvent) {
    if (milliSecondsUntilEvent === null) {
        return colors.off;
    }
    const secondsUntilEvent = milliSecondsUntilEvent / 1000;

    // If the event is starting in 15 seconds or started 15 seconds ago, set full red
    if (secondsUntilEvent >= -15 && secondsUntilEvent <= 15) {
        return colors.imminentStart;
    }
    if (secondsUntilEvent <= 0) {
        return colors.started;
    }
    if (secondsUntilEvent >= HOUR) {
        const totalIntervalInSeconds = FETCH_EVENTS_IN_NEXT_X_HOURS * 60 * 60;
        const remainingInterval = secondsUntilEvent /totalIntervalInSeconds;
        const maxBlue = 50;
        const maxGreen = 200;
        const blue = Math.floor(maxBlue * remainingInterval);
        // Green gets brighter the closer we get to an hour
        const green = Math.floor(maxGreen * (1 - remainingInterval));
        return [0, green, blue];
    } else if (secondsUntilEvent > MINUTE * 10) {
        const remainingInterval = secondsUntilEvent / HOUR ;
        const maxRed = 100;
        const maxGreen = 75;
        const minGreen = 20;
        // Red gets brighter the closer we get to ten minutes
        const red = Math.floor(maxRed * (1 - remainingInterval));
        const green = Math.floor((maxGreen * remainingInterval) + minGreen);
        return [red, green, 0];
    } else {
        const remainingInterval = secondsUntilEvent / (MINUTE * 10);
        const maxRed = 200;
        const minRed = 50;
        const maxGreen = 30;
        const red = Math.min(200, (Math.floor(maxRed * (1 - Math.max(0, remainingInterval))) + minRed));
        const green = Math.max(0, Math.floor(maxGreen * remainingInterval));
        return [red, green, 0];
    }
}

function getPendingColor(pendingCount) {
    if (pendingCount >= MAX_PENDING_EVENTS) {
        return [0, 0, 255];
    } else {
        return [0, 0, 50 * pendingCount]
    }
}

function getLed(index) {
    return START_LED + (index * INCREMENT_LED);
}

async function setLed(index, r, g, b) {
    [r,g,b].forEach((v, i) => {
        if (v > 255 || v < 0) {
            console.log('Invalid value index:', i, 'value: ', v);
        }
    })
    const url = `${WEB_URL}/${index}/${r}/${g}/${b}/0`;
    queue.push(url);
}

async function checkCalendarEvents() {
    let events = cache.get('events');
    if (!events) {
        console.log('No cache fetching dates', new Date())
        events = await calendar(FETCH_EVENTS_IN_NEXT_X_HOURS);
        events.sort((a, b) => (new Date(a.start.dateTime)).getTime() - (new Date(b.start.dateTime)).getTime());
        cache.set('events', events);
    }
    const now = (new Date()).getTime();
    const dates = events.map(e => ({
        milliSecondsUntilEvent: new Date(e.start.dateTime || e.start.date).getTime() - now,
        end: new Date(e.end.dateTime).getTime()
    })).filter(d => d.end > new Date().getTime());

    //Remove any events that have ended (but are still cached)
    let pendingCounter = 0;
    while (dates.length < INDIVIDUAL_EVENT_COLUMN_COUNT + 1) {
        dates.push({milliSecondsUntilEvent: null})
    }
    let displayColumnCount = INDIVIDUAL_EVENT_COLUMN_COUNT;

    dates.forEach(({milliSecondsUntilEvent, end}, i) => {
        if (i < displayColumnCount) {
            if (i === 0 && milliSecondsUntilEvent !== null && milliSecondsUntilEvent < 0) {
                // It is the first found event and it has already started
                // Shift the led 1 to the right for the current meeting
                displayColumnCount++;
                setLed(START_LED - 1, ...generateColor(milliSecondsUntilEvent));
            } else {
                const index = displayColumnCount === INDIVIDUAL_EVENT_COLUMN_COUNT ? i : i - 1;
                setLed(getLed(index), ...generateColor(milliSecondsUntilEvent));
            }

        } else if (milliSecondsUntilEvent !== null) {
            pendingCounter++;
        }
    })
    if (displayColumnCount === INDIVIDUAL_EVENT_COLUMN_COUNT) {
        //There were no in progress events
        setLed(START_LED - 1, ...colors.off)
    }
    setLed(getLed(INDIVIDUAL_EVENT_COLUMN_COUNT), ...getPendingColor(pendingCounter))
}

async function checkServer({url, checkParams, resultLedValues}) {
    let success = false;
    try {
        let result;
        if (typeof url === 'string') {
            result = await fetch(url);

        }  else {
           result = await url();
        }
        const body = checkParams.type === 'json' ? await result.json() : await result.text();
        success = (checkParams.type === 'json') ? (body[checkParams.key] === checkParams.value) :  (body.indexOf(checkParams.value) > -1);

    } catch (e) {
        console.error(url, e);
        success = false;
    }
    setLed(resultLedValues[success ? 'success' : 'error'].led, ...resultLedValues[success ? 'success' : 'error'].colors)
    return success;
}

async function checkServers() {
    const promises = serverChecks.map(checkServer)
    Promise.all(promises).then(r => {
    })
}

async function pollQueue() {
    if (queueRunning) {
        return
    }
    queueRunning = true;
    while (queue.length) {
        const url = queue.shift();
        try {
            await fetch(url)
        } catch (e) {
            console.error(`Error in request to ${url}`, e)
        }
    }
    queueRunning = false;
}

function main() {
    setInterval(() => {
        checkServers().then(r => {
        })
    }, 30000)

    setInterval(() => {
        checkCalendarEvents().then(r => {
        }).catch(e => console.error(e));
    }, 15000)

    setInterval(pollQueue, 1000);
}

checkServers();
checkCalendarEvents()
main();
