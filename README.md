express-easy-signing
=============

Node request signing middleware for Express designed to make building an HMAC signed API easy.

When implemented, all HTTP requests are validated against a list of API keys and secrets on the server.

### Usage

```javascript

const express = require('express');
const app = express();

const { EasySign } = require('express-easy-signing');
const auth = new EasySign();

app.use(auth.middleware());

const secretForAPIKey = {
  exampleAPIKeyOne: 'secreTOne',
  exampleAPIKeyTwo: 'secretTwo'
};

// Required. Execute callback with either an error, or an API key.
auth.secretForKey = (apiKey, callback) => {

  if (secretForAPIKey.hasOwnProperty(apiKey)) {

    callback(null, secretForAPIKey[apiKey]);
    return;
  }

  callback({
    message: 'API key not found'
  });
};

// Required. Handle requests that have failed authentication.
auth.on('rejected', ({error, request, response, next}) => {

  response.status(401).json({
    error: error
  });
});

// Required. Handle critical issues, e.g. there was an issue finding the secret for an API key
auth.on('error', ({error, request, response, next}) => {

  response.status(500).json({
    error: error
  });
});

// Setup all routes
app.all('*', (request, response) => {
  response.status(200).end('200');
});

app.listen(80, () => {
  console.log('Listening');
});

```

### Client

A client that implements HMAC hashing is also included. To write a client for your service, simply extend the class and add functions that match your API routes. The client functions are written 

```javascript

const { EasySignClient } = require('express-easy-signing');

class SampleClient extends EasySignClient {

  constructor(apiKey, secret, settings) {
    super(apiKey, secret, settings);
    
    self.settings.host = 'api.myservice.com';
    self.settings.port = 443;
    self.settings.ssl = true;
  }

  create(data, callback) {
    return this.call('POST', '/items/', data, undefined, callback);
  }

  detail(id, parameters, callback) {
    return this.call('GET', '/items/' + encodeURIComponent(id), undefined, parameters, callback);
  }

  query(parameters, callback) {
    return this.call('GET', '/items/', undefined, parameters, callback);
  }

  update(id, data, callback) {
    return this.call('POST', '/items/' + encodeURIComponent(id), data, undefined, callback);
  }

  delete(id, callback) {
    return this.call('DELETE', '/items/' + encodeURIComponent(id), undefined, undefined, callback);
  }
}

module.exports = SampleClient;

```

Client instantiation

```javascript
const client = new SampleClient(apiKey, secret);
```

The client implements both promises and callbacks, so your client may use either.

```javascript
const query = {
  string: 'string',
  boolean: true,
  number: 42
};

try {

  const results = await client.query(query);
  
  console.log(results);

} catch (error) {

  console.log('Error:', error);
}
```

```javascript 
const query = {
  string: 'string',
  boolean: true,
  number: 42
};

client.query(query, (error, results) => {

  if (error) {
    console.log('Error:', error);
    return;
  }

  console.log(results);
});

```


### Explanation

For all incoming requests, the HTTP method, path, query string, headers and body should be signed with a secret and sent as the request's "signature." The headers should the user's API key, as well as a timestamp of when the request was made. On the server, the request is confirmed against the signature. If the signature does not match, the request is rejected. If the server receives a request with a timestamp older than five minutes, it is also rejected.

This enables three things:
- Verify the authenticity of the client
- Prevent MITM attack
- Protect against replay attacks

The client's authenticity is confirmed by their continued ability to produce signatures based on their secret. This approach also prevents man-in-the-middle attacks because any tampering would result in the signature mismatching the request's contents. Finally, replay attacks are prevented because signed requests with old timestamps will be rejected.

Each request requires three headers: `x-api-key`, `date`, and `authorization`. If the HTTP request contains a body, the `content-length` and `content-type` headers are also required.

The `x-api-key` header should contain the string representation of the user's API key.

The `date` header is a standard [RFC-822 (updated in RFC-1123)](https://tools.ietf.org/html/rfc822#section-5) date, as per [RFC-7231](https://tools.ietf.org/html/rfc7231#section-7.1.1.2).

The `authorization` header is a standard as per [RFC-2617](https://tools.ietf.org/html/rfc2617#section-3.2.2) that, confusingly, is designed for authentication and not authorization. It contains a signature of the entire request.

To calculate the signature, the client first needs to create a string representation of the request. When the server recieves an authenticated request it computes the the signature and compares it with the signature provided by the client. Therefore, the client must create a string representation of the request in the exact same way as the platform. This is called "canonicalization."

The format of a canonical representation of a request is:
```
     HTTP Verb + \n
     URI + \n
     Canonical query string + \n
     Canonically formatted signed headers + \n
     Hashed body payload
```

The canonical representations of these elements are as follows

|Component|Format|Example|
|---------|------|-------|
|HTTP Verb | upperCase(verb) | POST, GET or DELETE |
|URI | encode(uri) | /items/test%20item|
|Query String | encode(paramA) + '=' + encode(valueA) + '&' + encode(paramB) + '=' + encode(valueB) | paramA=valueA&paramB=value%20B |
|Headers | lowerCase(keyA) + ':' + trim(valueA) + '\n' + lowerCase(keyB) + ':' + trim(valueB) | keyA:valueA<br>keyB:value%20B 
|Hashed payload | hex(hash('sha256', bodyData)) | ... |

The HTTP verb must be upper case. The URI should be url-encoded. The query string elements should be alphabetically sorted. The header keys must all be lower case (as per [RFC-2616](http://www.ietf.org/rfc/rfc2616.txt)) and alphabetically sorted. The only headers included in the signature should be: `x-api-key`, `date`, and optionally `content-length` and `content-type` if the HTTP body is not empty. The last line of the request string should be a hex representation of a SHA256 hash of the request body. If there is no request body, it should be the hash of an empty string.

Programatically:
```
     upperCase(method) + \n
     path + \n
     encode(paramA) + '=' + escape(valueA) + '&' + escape(paramB) + '=' + escape(valueB) + \n
     lowerCase('a-api-key') + ':' + trim(_API_KEY_) + \n + lowerCase(content-length) + ':' + trim('15') + \n
     hex(hash('sha256', bodyData)) + \n
```

For Example
```
     POST
     /items/test
     paramA=valueA&paraB=value%20B
     content-length:15
     date:Tue, 20 Apr 2016 18:48:24 GMT
     x-api-key:12345
     8eb2e35250a66c65d981393c74cead26a66c33c54c4d4a327c31d3e5f08b9e1b
```
     
Then the HMAC signature of the entire request is generated by signing it with the secret, as a hex representation:
```
const signature = hex(hmacSha256(secret, requestString))
```

That value is then sent as the contents of the `authorization` header, with the preceding value 'signature'.
```
headers[authorization] = 'signature ' + signature
```

