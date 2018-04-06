// ===================== GLOBALS SETUP ===========================
const fs = require('fs');
const http = require('http');
const path = require('path');
const cors = require('cors');
const ytdl = require('ytdl-core');
const express = require('express');
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const exec = require('child_process').execFile;
// ======================= APP SETUP =============================
const app = express();
const server = http.createServer(app);
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.resolve(__dirname, 'client')));
server.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", function() {
    console.log("Youtube Downloader listening at", server.address().address + ":" + server.address().port);
});
// ===================== FIREBASE SETUP ==========================
admin.initializeApp({
    credential: admin.credential.cert(require("./json/yoga-master-training-db-d9acdc86dca0.json")),
    databaseURL: "https://yoga-master-training-db.firebaseio.com"
});
var db = admin.database();
// ===================== ROUTING SETUP ===========================
app.get('/api', (req, res) => res.send({ "return": 'Hello World @ Training Server DB API!' }));

app.post('/postapi', function(req, res) {
    console.log("Got a POST!");
    var videoID = ytdl.getVideoID(req.body.url);
    console.log((ytdl.validateURL("youtube.com/watch?v=" + videoID) ? "Found and getting video" : "No video found OR not a valid video") + " with ID \"" + videoID + "\" from \"" + req.body.url + "\"");
    var fps = 30;
    if (ytdl.validateURL("youtube.com/watch?v=" + videoID))
        fps = downloadYoutubeVideo("youtube.com/watch?v=" + videoID);
    //!!!!!!!!Video needs to be detected as done downloading, then you can do the math below:
    console.log(req.body);
    var length = (Object.keys(req.body).length - 1) / 5;
    //req.body contains url, timestamps and selected pose    
    //turn timestamps into frames based off  video's fps as so: 'eq(n\,180)+eq(n\,210)'
    var framesDict = {};
    for (var i = 1; i < length; i++) {
        var startMin = req.body["startTimeStampMin" + i];
        var startSec = req.body["startTimeStampSec" + i];
        var endMin = req.body["endTimeStampMin" + i];
        var endSec = req.body["endTimeStampSec" + i];
        var pose = req.body["selectedPose" + i];
        var startTime = startMin * 60 + startSec;
        var endTime = endMin * 60 + endSec;
        var startFrame = startTime * fps;
        var endFrame = endTime * fps;
        if (framesDict[pose] === undefined) framesDict[pose] = [];
        framesDict[pose].push([startFrame, endFrame]);
        // framesDict[startFrame] = pose;
        // framesDict[endFrame] = pose;
    }
    convertToFrames(framesDict);
    // convertToFrames(Object.keys(framesDict));
    res.redirect('/');
});

// ========================== CALL FUNCTIONS ==========================
function downloadYoutubeVideo(url) {
    ytdl(url, { filter: (format) => format.container === 'mp4' }).pipe(fs.createWriteStream('videos/unprocessed/video.mp4'));
    //var exec = require('child_process').execFile;
    exec('ffprobe', ['-v', '0',
        '-of', 'csv=p=0',
        '-select_streams', '0',
        '-show_entries',
        'stream=r_frame_rate',
        'infile'
    ], (error, stdout, stderr) => {
        var top = parseInt(stdout.substring(0, stdout.indexOf("/")));
        var bot = parseInt(stdout.substring(stdout.indexOf("/")));
        console.log(top + " is divided by " + bot);
        return top / bot;
    });
}

function convertToFrames(framesDict) {
    var framesList = "";

    // [[start1, end1, pose],
    //  [start2, end2, pose],
    //  [start3, end3, pose]]

    //{ "warriorII": [[start1, end1], [start2, end2]],
    //  "triangle": [[start1, end1], [start2, end2]],
    //  "tree": [[start1, end1], [start2, end2]]}

    for (var key in Object.keys(framesDict)) {
        for (var frame in framesDict[key])
            for (var i = frame[0]; i <= frame[1]; i++)
                framesList = framesList + "eq(n\\," + i + ")+";
        framesList = framesList.substring(0, framesList.lastIndexOf("+"));
        exec('ffmpeg', ['-i', '"CHANGE VIDEO NAME"video.mp4',
            '-vf', 'select=\'' + framesList + '\'',
            '-vsync', '0', 'frame' + key + '%d.jpg'
        ]);
    }
}
// ffmpeg -i video.mp4 -vf select='"+genFrames+"' -vsync 0 frames+"selectedPose"+%d.jpg
// ffprobe -v 0 -of csv=p=0 -select_streams 0 -show_entries stream=r_frame_rate infile
