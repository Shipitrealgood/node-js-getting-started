const express = require('express')
const path = require('path')

const port = process.env.PORT || 5006

const app = express()

// --- Health probe ---
app.get('/health', (req, res) => res.send('OK'));

// --- parse JSON bodies ---
app.use(express.json());

// --- Zoom webhook endpoint ---
app.post('/webhook', (req, res) => {
  console.log('Webhook hit:', JSON.stringify(req.body));
  res.sendStatus(200);          // quick “OK” reply
});

app.use(express.static(path.join(__dirname, 'public')))
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.get('/', (req, res) => {
  console.log(`Rendering 'pages/index' for route '/'`)
  res.render('pages/index')
})

const server = app.listen(port, () => {
  console.log(`Listening on ${port}`)
})

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: gracefully shutting down')
  if (server) {
    server.close(() => {
      console.log('HTTP server closed')
    })
  }
})
