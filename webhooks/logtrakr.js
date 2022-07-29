const fetch = require("node-fetch");
const STATUS = {
    accepted: "a",
    needsAction: "p",
    tentative: "m",
    declined: "d",
    creator: "c"
}

module.exports = async (events = []) => {
    try {
        const token = process.env.LOGTRAKR_TOKEN;
        const companyId = process.env.LOGTRAKR_COMPANY_ID;
        const headers = {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-current-company": `${companyId}`,
        };
        const result = await fetch(
            "https://app.logtrakr.com/api/v1/user_times/active/",
            {
                headers,
            }
        );

        const activeJobs = await result.json();
        const activeJob = activeJobs.shift();
        if (activeJob) {
            const activeTime = activeJob.job.active_times.shift();
            const {id, note = ""} = activeTime;
            let secondsInMeetings = 0;
            let today = '';
            const eventsList = events
                .map((e) => {
                    let total = 0;
                    if (e.start.dateTime && e.end.dateTime) {
                        const start = new Date(e.start.dateTime);
                        const end = new Date(e.end.dateTime);
                        total = (end.getTime() - start.getTime()) / 1000;
                        secondsInMeetings += total;
                    }
                    if (!today) {
                        today = (e.start.dateTime || e.start.date).split('T').shift();
                    }


                    const status =
                        STATUS[e.creator.self ? 'creator' : ((e.attendees || []).find((a) => a.self) || {}).responseStatus || 'accepted'];
                    const note = `${e.summary
                        .replace(/[^\x00-\x7F]+/g, "")
                        .trim()} - ${
                        e.start.dateTime || e.start.date
                    } (${total.toHHMMSS()})`;
                    return {
                        status,
                        note
                    }
                });

            let editedNote = note || '';
            let eventsText = [];
            eventsList.forEach(({status, note}) => {
                const re = new RegExp(`^\\[.+\\] \\b${escapeRegExp(note)}\n`, 'gm');
                editedNote = editedNote.replace(re, '');
                eventsText.push(`[${status}] ${note}`);
            })

            if (!eventsText.length) {
                return;
            }
            let totalMeetingTimeRegex = new RegExp(`Total Meeting Time \\(${escapeRegExp(today)}\\): \\d{2}:\\d{2}:\\d{2}\\n*`, 'g')
            let newNote = editedNote.replace(
                totalMeetingTimeRegex,
                ""
            ).replace(/^$\n/gm, "");
            newNote = `${newNote ? newNote + "\n" : ""}${eventsText.join("\n")}\nTotal Meeting Time (${today}): ${secondsInMeetings.toHHMMSS()}`;
            const updateResult = await fetch(
                `https://app.logtrakr.com/api/v1/user_times/edit/${id}`,
                {
                    headers,
                    method: "PUT",
                    body: JSON.stringify({note: newNote}),
                }
            );
        }
    } catch (e) {
        console.error("Logtrakr Error", e);
    }
};

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

Number.prototype.toHHMMSS = function () {
    var sec_num = parseInt(this, 10);
    var hours = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - hours * 3600) / 60);
    var seconds = sec_num - hours * 3600 - minutes * 60;

    if (hours < 10) {
        hours = "0" + hours;
    }
    if (minutes < 10) {
        minutes = "0" + minutes;
    }
    if (seconds < 10) {
        seconds = "0" + seconds;
    }
    return hours + ":" + minutes + ":" + seconds;
};
