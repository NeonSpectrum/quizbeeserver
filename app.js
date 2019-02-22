require('dotenv').config()
var express = require('express')
var bodyParser = require('body-parser')
var _ = require('underscore')
var app = express()
var server = require('http').Server(app)
var io = require('socket.io')(server)
var { MongoClient, ObjectID } = require('mongodb')

var db = null

var servers = {}

var config = {
  allowRepeatable: false
}

server.listen((port = process.env.PORT || 3000), async () => {
  await connect()
  console.log('Connected at port ' + port)
})

app.use(bodyParser.json())
app.use(express.static(__dirname + '/public'))

app.get('/checkroomavailability', function(req, res) {
  res.json({ available: servers[req.query.name] == undefined })
})

app.get('/rooms', function(req, res) {
  const list = io.sockets.adapter.rooms || {}

  res.json({ list, servers })
})

app.put('/room', function(req, res) {
  const { name, password } = req.body
  console.log(req.body)
  servers[name] = { password, gaveQuestions: [], scores: {} }
})

app.post('/room', function(req, res) {
  const { name, password } = req.body

  if (!servers[name] || servers[name].password != password) {
    res.json({ success: false })
    return
  }

  res.json({ success: true })
})

app.get('/room/:id', function(req, res) {
  const { id } = req.params
  const { password } = req.body

  if (!servers[id]) {
    res.json({ success: false, error: "Room doesn't exists." })
    return
  }

  if (servers[id].password != password) {
    res.json({ success: false, error: 'Invalid Password.' })
    return
  }

  res.json({ success: true })
})

io.on('connection', function(socket) {
  socket.on('join', name => {
    console.log('someone joined ' + name)
    socket.join(name)
  })
  socket.on('leave', name => {
    console.log('someone leave ' + name)
    socket.leave(name)
  })
})

function getItem() {
  return new Promise((resolve, reject) => {
    db.collection('items')
      .find({})
      .toArray(function(err, item) {
        console.log(item)

        if (config.allowRepeatable) {
          questions = _.shuffle(item)
        } else {
          questions = _.shuffle(item.filter(x => gaveQuestions.indexOf(x._id.toString()) === -1))
        }

        if (questions[0]) gaveQuestions.push(questions[0]._id.toString())
        resolve(questions[0] || false)
      })
  })
}

async function connect() {
  const { DB_USER, DB_PASS, DB_HOST, DB_NAME } = process.env
  const url = DB_USER ? `mongodb://${DB_USER}:${DB_PASS}@${DB_HOST}` : `mongodb://${DB_HOST}`

  try {
    const client = await MongoClient.connect(url, { useNewUrlParser: true })
    db = client.db(process.env.DB_NAME)
    console.log('Connected successfully to database')
  } catch (err) {
    console.log('Error connecting to database.')
  }
}
