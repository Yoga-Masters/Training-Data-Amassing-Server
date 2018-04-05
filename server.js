// ===================== GLOBALS SETUP ===========================
const fs = require('fs');
const http = require('http');
const path = require('path');
const cors = require('cors');
const ytdl = require('ytdl-core');
const express = require('express');
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
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
    console.log(req.body);
    var videoID = ytdl.getVideoID(req.body.url);
    console.log((ytdl.validateURL("youtube.com/watch?v=" + videoID) ? "Found and getting video" : "No video found OR not a valid video") + " with ID \"" + videoID + "\" from \"" + req.body.url + "\"");
    if (ytdl.validateURL("youtube.com/watch?v=" + videoID))
        downloadYoutubeVideo("youtube.com/watch?v=" + videoID);
    // res.send('Got a POST request');
    res.redirect('/');
});

// ========================== CALL FUNCTIONS ==========================
function downloadYoutubeVideo(url) {
    ytdl(url).pipe(fs.createWriteStream('videos/unprocessed/video.flv'));
}
