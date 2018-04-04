const http = require('http');
const path = require('path');
const express = require('express')
const app = express();
const server = http.createServer(app);
const admin = require("firebase-admin");
admin.initializeApp({
    credential: admin.credential.cert(require("./json/yoga-master-training-db-d9acdc86dca0.json")),
    databaseURL: "https://yoga-master-training-db.firebaseio.com"
});
app.use(express.static(path.resolve(__dirname, 'client')));
app.get('/', (req, res) => res.send('Yo World!'))
server.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", function() {
    var addr = server.address();
    console.log("Chat server listening at", addr.address + ":" + addr.port);
});
