var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.use(express.static('js'));

app.get('/', function(req, res){
  res.sendfile('index.html');
});

// Expects bubble object:
// {
//   latitude: 37.2350, # Required
//   longitude: 115.8111, # Required
//   color: #6CC417, # Required
//   duration: 51 # Optional, in seconds
// }
//
// Adds a bubble to the map with the given properties.
app.post('/', function(request, response){
  var jsonString = '';

  request.on('data', function (data) {
      jsonString += data;
  });

  request.on('end', function () {
    io.sockets.emit(
      'addBubble',
      JSON.parse(jsonString)
    );
  });

  response.writeHead(200)
  response.end();
});

http.listen(3006, function(){
  console.log('listening on *:3006');
});


// Here's the Ruby code you need to post to this server
// uri = URI.parse('http://localhost:3006/')

// Net::HTTP.new(uri.host, uri.port).start do |client|
//   request                 = Net::HTTP::Post.new(uri.path)
//   request.body            = "{}"
//   request["Content-Type"] = "application/json"
//   client.request(request)
// end
