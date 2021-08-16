#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');
const cache = require('./cache');
const calendar = require('./calendar')
const serverChecks = require('./servers');
const {exec} = require('child_process');

const STATUS_LED = parseInt(process.env.STATUS_LED) || 0;
const FETCH_EVENTS_IN_NEXT_X_HOURS = process.env.FETCH_EVENTS_IN_NEXT_X_HOURS || 12;
const START_LED = parseInt(process.env.START_LED) || 3;
const INCREMENT_LED = parseInt(process.env.INCREMENT_LED) || 8;
const INDIVIDUAL_EVENT_COLUMN_COUNT = parseInt(process.env.INDIVIDUAL_EVENT_COLUMN_COUNT) || 3;
const MAX_PENDING_EVENTS = parseInt(process.env.MAX_PENDING_EVENTS) || 5;
const WEB_URL = process.env.WEB_URL;
const PICO_DEV = process.env.PICO_DEV;
const HOUR = 60 * 60;
const MINUTE = 60;
const STARTING_IN_MINUTES = process.env.STARTING_IN_MINUTES || 10;
const queue = [];
let queueRunning = false;
let picoCache = '';
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
        const remainingInterval = secondsUntilEvent / totalIntervalInSeconds;
        const maxBlue = 50;
        const maxGreen = 200;
        const blue = Math.floor(maxBlue * remainingInterval);
        // Green gets brighter the closer we get to an hour
        const green = Math.floor(maxGreen * (1 - remainingInterval));
        return [0, green, blue];
    } else if (secondsUntilEvent > MINUTE * 10) {
        const remainingInterval = secondsUntilEvent / HOUR;
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

function getMsSinceMidnight(d) {
    const e = new Date(d);
    return d - e.setHours(0, 0, 0, 0);
}

async function setLed(index, r, g, b, name = '') {
    [r, g, b].forEach((v, i) => {
        if (v > 255 || v < 0) {
            console.log('Invalid value index:', i, 'value: ', v);
        }
    })
    queue.push({index, rgb: [r, g, b, 0], name});
}

async function getCalendarEvents() {
    let events = cache.get('events');
    if (!events) {
        console.log('No cache fetching dates', new Date())
        events = await calendar(FETCH_EVENTS_IN_NEXT_X_HOURS);
        events.sort((a, b) => (new Date(a.start.dateTime)).getTime() - (new Date(b.start.dateTime)).getTime());
        cache.set('events', events);
    }
    return events;
}

async function checkCalendarEvents() {
    const events = await getCalendarEvents();
    const now = (new Date()).getTime();
    const dates = events.map(e => {
        let startDate = new Date(e.start.dateTime || e.start.date);
        let hours = startDate.getHours();
        hours = hours >= 10 ? hours : `0${hours}`;
        let minutes = startDate.getMinutes();
        minutes = minutes >= 10 ? minutes : `0${minutes}`;
        const startTimeString = hours + ':' + minutes;
        const milliSecondsUntilEvent = startDate.getTime() - now;
        const endMillis = new Date(e.end.dateTime).getTime();
        const totalSeconds = (endMillis - startDate.getTime()) / 1000;

        return {
            startDate,
            milliSecondsUntilEvent,
            end: endMillis,
            summary: e.summary,
            startTime: startTimeString,
            startSecsFromMidnight: getMsSinceMidnight(startDate) / 1000,
            startingSoon: milliSecondsUntilEvent <= 1000 * 60 * STARTING_IN_MINUTES,
            totalSeconds,
        }
    }).filter(d => d.end > new Date().getTime());

    const updatePicoCmd = JSON.stringify(dates.map(d => {
        const result = {...d};
        result.summary = result.summary.replace(/[^\x00-\x7F]+/, '').trim()
        // Must remove this so it stops changing on every request
        delete result.milliSecondsUntilEvent;
        return result
    }));
    if (PICO_DEV) {
        if (picoCache === '') {
            //Set the time
            const now = new Date();
            const Y = now.getFullYear();
            const M = now.getMonth() + 7;
            const D = now.getDate();
            const h = now.getHours();
            const m = now.getMinutes();
            const s = now.getSeconds();
            const timeData = {"timeSync": `${Y} ${M} ${D} ${h} ${m} ${s}`};
            console.log('Setting pico time to', timeData)
            exec(`echo '${JSON.stringify(timeData)} ' > ${PICO_DEV}`);
        }
        if (picoCache !== updatePicoCmd) {
            picoCache = updatePicoCmd;
            console.log("Sending to pico: ", updatePicoCmd)
            exec(`echo '${updatePicoCmd}' > ${PICO_DEV}`);
        }
    }


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

async function checkServer({url, headers, checkParams, resultLedValues, name}) {
    let success = false;
    try {
        let ledIndex, colors;

        if (typeof url === 'string') {
            const result = await fetch(url, {
                headers: {
                    ...headers
                }
            });
            const body = checkParams.type === 'json' ? await result.json() : await result.text();
            success = (checkParams.type === 'json') ? (body[checkParams.key] === checkParams.value) : (body.indexOf(checkParams.value) > -1);
            ledIndex = resultLedValues[success ? 'success' : 'error'].led;
            colors = resultLedValues[success ? 'success' : 'error'].colors;
        } else {
            const result = await url();
            ledIndex = result.ledIndex;
            colors = result.colors;
        }
        setLed(ledIndex, ...colors, name)

    } catch (e) {
        console.error(url, e);
        success = false;
    }

    return success;
}

async function checkServers() {
    const promises = serverChecks.map(checkServer)
    Promise.all(promises).then(r => {
    })
}

async function pollQueue() {
    if (queueRunning || !queue.length) {
        return
    }
    queueRunning = true;
    const body = {};
    while (queue.length) {
        const {index, rgb, name} = queue.shift();
        body[index] = {rgb, name};
    }
    if (WEB_URL) {
        try {
            await fetch(WEB_URL, {
                method: 'PATCH',
                body: JSON.stringify({values: body}),
                headers: {
                    'content-type': 'application/json',
                    'user-agent': 'YatBot.rs'
                }
            })
        } catch (e) {
            console.error(`Error in request to ${WEB_URL}`, e)
        }
    }
    queueRunning = false;
}

function main() {
    const statusRgb = [0, 0, 0];
    setInterval(() => {
        checkServers().then(r => {
            statusRgb[0] = 0;
        }).catch(e => {
            console.error(e);
            statusRgb[0] = 255;
        })
    }, 30000)

    setInterval(() => {
        checkCalendarEvents().then(r => {
            statusRgb[2] = 0;
        }).catch(e => {
            console.error(e)
            statusRgb[2] = 255;

        }).finally(() => {
            const errorMessage = `${statusRgb[0] > 0 && 'Server Status Error'} ${statusRgb[2] > 0 && 'Calendar Check Error'}`
            setLed(STATUS_LED, ...statusRgb, errorMessage)
        });
    }, 15000)

    setInterval(pollQueue, 1000);
}

const args = process.argv.slice(2);
if (args.length) {
    const path = require('path');
    const webhookPath = path.resolve('webhooks', args[0].replace(/webhooks\/?/, '').replace(/^\//, ''));
    console.log('Loading webhook', webhookPath);
    const webhook = require(webhookPath);

    getCalendarEvents().then(events => webhook(events)).catch(e => console.error(e));
} else {
    checkServers();
    checkCalendarEvents()
    main();
}

