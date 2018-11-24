//
//  Simple HMAC Auth
//  /usage/server/http_roundtrip/index.js
//  Created by Jesse Youngblood on 11/23/18 at 23:53
// 

/* eslint no-console: off, no-unused-vars: off */

'use strict';

const http = require('http');
const SimpleHMACAuth = require('../../../index');

const settings = {
  port: 8000,
  secretsForAPIKeys: {
    'API_KEY': 'SECRET',
    'API_KEY_TWO': 'SECRET_TWO',
    'API_KEY_THREE': 'SECRET_THREE',
  }
};

const auth = new SimpleHMACAuth.Server({verbose: true});

// Required. Execute callback with either an error, or an API key.
auth.secretForKey = (apiKey, callback) => {

  if (settings.secretsForAPIKeys.hasOwnProperty(apiKey)) {

    callback(null, settings.secretsForAPIKeys[apiKey]);
    return;
  }

  callback();
};


const dataListenerRequestHandler = async (request, response) => {

  console.log(`Processing new request:`, new Date());

  let data = '';

  request.on('data', chunk => { 
    data += chunk.toString();
  });

  request.on('end', async () => {

    console.log(`Got request ${request.method} ${request.url}`);
    console.log(`Data:`, data);

    try {

      // Send the data we just got in for authentication
      const { apiKey, signature } = await auth.authenticate(request, data);

      console.log(`  Authentication passed for request with API key "${apiKey}" and signature "${signature}".`);

      response.writeHead(200);
      response.end('200');

    } catch (error) {

      console.log(`  Authentication failed`, error);

      response.writeHead(401);
      response.end(JSON.stringify({error}));
    }

  });

};

const immediateRequestHandler = async (request, response) => {

  console.log(`Processing new request:`, new Date());

  console.log(`Got request ${request.method} ${request.url}`);

  try {

    // Sending 'true' as the 2nd parameter will automatically read the request data for us.
    const { apiKey, signature } = await auth.authenticate(request, true);

    console.log(`  Authentication passed for request with API key "${apiKey}" and signature "${signature}".`);

    response.writeHead(200);
    response.end('200');

  } catch (error) {

    console.log(`  Authentication failed`, error);

    response.writeHead(401);
    response.end(JSON.stringify({error}));
  }

};

// Create HTTP server
const server = http.createServer(dataListenerRequestHandler).listen(settings.port);

console.log(`Listening on port ${settings.port}`);

const client = new SimpleHMACAuth.Client('API_KEY', 'SECRET', {
  verbose: true,
  host: 'localhost',
  port: settings.port,
  ssl: false
});

const options = {
  method: 'POST',
  path: '/items/',
  query: {
    string: 'string',
    boolean: true,
    number: 42,
    object: { populated: true },
    array: [ 1, 2, 3 ]
  },
  data: {
    string: 'string',
    boolean: true,
    number: 42,
    object: { populated: true },
    array: [ 1, 2, 3 ]
  }
};

client.request(options).then(response => {

  console.error(`Client response:`, response);
  server.close();

}).catch(error => {

  console.error(`Client error:`, error);
  server.close();
});

