require('dotenv').config()
var express = require('express')
var bodyParser = require('body-parser')
var _ = require('underscore')
var app = express()
var server = require('http').Server(app)
var io = require('socket.io')(server)
var { MongoClient, ObjectID } = require('mongodb')

var db = null

var config = {
  allowRepeatable: true
}

var defaultRoomConfig = {
  item: {},
  gaveQuestions: [],
  players: {},
  started: false,
  ended: false,
  total: 5
}

server.listen((port = process.env.PORT || 3000), async () => {
  await connect()
  console.log('Connected at port ' + port)
})

app.use(bodyParser.json())
app.use(express.static(__dirname + '/public'))
app.use((req, res, next) => {
  if (db != null) next()
  else res.send('Database is not connected.')
})

app.get('/rooms', async function(req, res) {
  const list = io.sockets.adapter.rooms || {}

  const rooms = await db
    .collection('rooms')
    .find({ ended: false })
    .toArray()

  res.json({ list, rooms: _.pluck(rooms, 'name') })
})

app.get('/test', async function(req, res) {
  res.json(await getRoomInfo('hello'))
})

app.put('/room', async function(req, res) {
  const { name, password = '' } = req.body
  console.log(req.body)

  const roomAvailable =
    (await db
      .collection('rooms')
      .find({ name })
      .count()) == 0

  if (roomAvailable) {
    db.collection('rooms').insertOne({ name, password, ...defaultRoomConfig }, (err, result) => {
      if (err) return res.json({ success: false, error: 'Error inserting data.' })

      res.json({ success: true })
    })
  } else {
    res.json({ success: false, error: 'Room already exists.' })
  }
})

app.post('/room', async function(req, res) {
  const { name, password } = req.body

  const room = await getRoomInfo(name)

  if (!room || room.password != password) {
    return res.json({ success: false, error: 'Invalid Password.' })
  } else if (room.ended) {
    return res.json({ success: false, error: "Room doesn't exists." })
  }

  res.json({ success: true })
})

io.on('connection', function(socket) {
  socket.on('join', async ({ username, roomName }) => {
    console.log(username + ' joined ' + roomName)
    socket.username = username
    socket.roomName = roomName

    const room = (await db
      .collection('rooms')
      .findOneAndUpdate(
        { name: roomName },
        { $set: { ['players.' + username]: { score: 0, left: false } } },
        { returnOriginal: false }
      )).value

    socket.join(roomName)

    io.to(roomName).emit('playerList', Object.keys(_.pick(room.players, x => x.left == false)))
  })

  socket.on('leave', () => {
    const { username, roomName } = socket

    if (!username || !roomName) return

    console.log(username + ' leave ' + roomName)

    if (!io.sockets.adapter.rooms[roomName]) {
      db.collection('rooms').updateOne({ name: roomName }, { $set: { ended: true } })
    } else {
      db.collection('rooms').updateOne(
        { name: roomName },
        { $set: { ['players.' + username + '.left']: true } }
      )
    }

    socket.leave(roomName)
  })

  socket.on('start', () => {
    giveQuestion(socket.roomName)
  })

  socket.on('pause', () => {
    io.to(socket.roomName).emit('pause')
  })

  socket.on('continue', () => {
    io.to(socket.roomName).emit('continue')
  })

  socket.on('reset', () => {
    io.to(socket.roomName).emit('pause')
  })

  socket.on('checkAnswer', async data => {
    const { username, roomName } = socket
    var room = await getRoomInfo(roomName)

    if (data.answer == room.item.answer) {
      console.log('correct')
      room = (await db
        .collection('rooms')
        .findOneAndUpdate(
          { name: roomName },
          { $inc: { ['scores.' + username]: 1 } },
          { returnOriginal: false }
        )).value
    }
    console.log(room)
    io.to(roomName).emit('updateScore', room.scores)
    giveQuestion(roomName)
  })

  socket.on('getCurrentData', () => {
    const { room } = socket
  })
})

async function giveQuestion(roomName) {
  const [items, room] = await Promise.all([
    db
      .collection('items')
      .find({})
      .toArray(),
    getRoomInfo(roomName)
  ])

  console.log(items)

  if (config.allowRepeatable) {
    questions = _.shuffle(items)
  } else {
    questions = _.shuffle(items.filter(x => room.gaveQuestions.indexOf(x._id.toString()) === -1))
  }

  if (questions[0]) {
    await db
      .collection('rooms')
      .updateOne(
        { name: roomName },
        { $set: { item: questions[0] }, $push: { gaveQuestions: questions[0]._id } }
      )
  }

  io.to(roomName).emit('giveItem', questions[0])
}

function getRoomInfo(name) {
  return new Promise(async resolve => {
    resolve(await db.collection('rooms').findOne({ name }))
  })
}

async function connect() {
  const { DB_USER, DB_PASS, DB_HOST, DB_NAME } = process.env
  const url = DB_USER
    ? `mongodb://${DB_USER}:${DB_PASS}@${DB_HOST}/${DB_NAME}`
    : `mongodb://${DB_HOST}/${DB_NAME}`

  try {
    db = await MongoClient.connect(url, {
      useNewUrlParser: true
    })
    console.log('Connected successfully to database')
  } catch (err) {
    console.log('Error connecting to database.' + err)
  }
}
