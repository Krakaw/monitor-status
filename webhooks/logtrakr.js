const fetch = require("node-fetch");
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
      const { id, note = "" } = activeTime;
      let secondsInMeetings = 0;
      const eventsText = events
        .map((e) => {
          let total = 0;
          if (e.start.dateTime && e.end.dateTime) {
            const start = new Date(e.start.dateTime);
            const end = new Date(e.end.dateTime);
            total = (end.getTime() - start.getTime()) / 1000;
            secondsInMeetings += total;
          }
          const attending =
            ((e.attendees || []).find((a) => a.self) || {}).responseStatus ===
            "accepted";
          return `[${attending ? "x" : " "}] ${e.summary
            .replace(/[^\x00-\x7F]+/g, "")
            .trim()} - ${
            e.start.dateTime || e.start.date
          } (${total.toHHMMSS()})`;
        })
        .filter((t) => {
          return (note || "").indexOf(t.replace(/^\[[x ]+\] /, "")) === -1;
        });

      if (!eventsText.length) {
        return;
      }
      let newNote = note.replace(
        /Total Meeting Time: \d{2}:\d{2}:\d{2}\n*/g,
        ""
      );
      newNote = `${newNote ? newNote + "\n" : ""}${eventsText.join(
        "\n"
      )}\nTotal Meeting Time: ${secondsInMeetings.toHHMMSS()}`;

      const updateResult = await fetch(
        `https://app.logtrakr.com/api/v1/user_times/edit/${id}`,
        {
          headers,
          method: "PUT",
          body: JSON.stringify({ note: newNote }),
        }
      );
    }
  } catch (e) {
    console.error("Logtrakr Error", e);
  }
};

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
