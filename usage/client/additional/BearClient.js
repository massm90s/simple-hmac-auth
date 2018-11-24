//
//  Simple HMAC Auth
//  /usage/client/BearClient.js
//  Sample Client subclass. This class may be used with either callbacks or promises
//  Created by Jesse T Youngblood on 3/23/16 at 10:42pm 
//    

'use strict';

const SimpleHMACAuth = require('../../../index');

class BearClient extends SimpleHMACAuth.Client {

  constructor(apiKey, secret, settings) {
    super(apiKey, secret, settings);

    // Replace with the host / port of your service
    this.settings.host = 'localhost';
    this.settings.port = 8000;
    this.settings.ssl = false;
  }

  create(data, callback) {
    return this.call('POST', '/bears/', data, undefined, callback);
  }

  detail(id, parameters, callback) {
    return this.call('GET', '/bears/' + encodeURIComponent(id), undefined, parameters, callback);
  }

  query(parameters, callback) {
    return this.call('GET', '/bears/', undefined, parameters, callback);
  }

  update(id, data, callback) {
    return this.call('POST', '/bears/' + encodeURIComponent(id), data, undefined, callback);
  }

  delete(id, callback) {
    return this.call('DELETE', '/bears/' + encodeURIComponent(id), undefined, undefined, callback);
  }
}

module.exports = BearClient;