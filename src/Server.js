//
//  Simple HMAC Auth
//  /src/Server.js
//  Created by Jesse T Youngblood on 3/24/16 at 2:29pm 
//    

'use strict';

const url = require('url');
const querystring = require('querystring');

const { sign, algorithms } = require('./sign');
const canonicalize = require('./canonicalize');

class SimpleHMACAuth {

  /**
   * Instantiate a new authentication object
   * @param {object}   [settings]
   * @param {function} [settings.secretForKey]                 Delegate function called to retrieve the secret for an API key
   * @param {boolean}  [settings.verbose=false]                If true, log debug information to the console
   * @param {number}   [settings.secretForKeyTimeout=10000]    How long until timing out on the secretForKey function
   * @param {number}   [settings.permittedTimestampSkew=60000] How far away from the current time to allow requests from
   * @param {string}   [settings.bodySizeLimit='5mb']          Default size limit for request body parsing
   */
  constructor(settings) {

    if (settings === undefined) {
      settings = {};
    }

    if (!settings.hasOwnProperty('verbose')) {
      settings.verbose = false;
    }

    if (!settings.hasOwnProperty('secretForKeyTimeout') || typeof settings.secretForKeyTimeout !== 'number') {

      settings.secretForKeyTimeout = 10 * 1000; // 10 seconds
    }

    if (!settings.hasOwnProperty('permittedTimestampSkew') || typeof settings.permittedTimestampSkew !== 'number') {

      settings.permittedTimestampSkew = 60 * 1000; // 10 seconds
    }

    if (!settings.hasOwnProperty('bodySizeLimit') || typeof settings.bodySizeLimit !== 'string') {

      settings.bodySizeLimit = '5mb';
    }

    if (typeof settings.secretForKey === 'function') {

      this.secretForKey = settings.secretForKey;
    }

    this.settings = settings;
  }

  /**
   * Log debug messages to the console, if 'verbose' is enabled.
   */
  log(...messages) {

    if (!this.settings.verbose) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`SimpleHMACAuth`, ...messages);
  }

  /**
   * Authenticate a request
   * @param   {object}  request - An HTTP request
   * @param   {object}  data - Body data for the request.
   * @returns {Promise} - Promise that resolves if the request authenticates, or rejects if it is not 
   */
  async authenticate(request, data) {

    return new Promise(async (resolve, reject) => {

      // Let's just assume the worst until we have reason to believe otherwise
      request.authenticated = false;

      // Make sure we have the full raw body of a request

      // If instead of including a body (or omitting one) 'true' is sent, manually process the raw body for this request.
      if (data === true) {

        try {

          data = await this._getRawBody(request);

          request.body = data;

        } catch (e) {

          reject(e);
        }
      }

      // Pull the API key from the request
      const apiKey = this._getApiKey(request);

      if (apiKey === undefined) {

        reject({
          message: `Missing API Key`,
          code: `API_KEY_MISSING`
        });
        return;
      }

      request.apiKey = apiKey;

      let secret;
      try {

        secret = await this._getSecretForKey(apiKey);

      } catch (error) {

        this.log(`Failed to load secret for API key "${apiKey}"`);

        if (error === undefined) {

          reject({
            message: `Internal failure while attempting to locate secret for API key "${apiKey}"`,
            code: `INTERNAL_ERROR_SECRET_DISCOVERY`
          });
          return;
        }

        reject(error);
        return;
      }

      if (secret === undefined) {

        reject({
          message: `Unrecognized API key: ${apiKey}`,
          code: `API_KEY_UNRECOGNIZED`
        });
        return;
      }

      request.secret = secret;

      if (!request.headers.hasOwnProperty('authorization')) {

        reject({
          message: `Missing authorization. Please sign all incoming requests with the 'authorization' header.`,
          code: `AUTHORIZATION_HEADER_MISSING`
        });
        return;
      }

      if (!request.headers.hasOwnProperty('date')) {

        reject({
          message: `Missing timestamp. Please timestamp all incoming requests by including 'date' header.`,
          code: `DATE_HEADER_MISSING`
        });
        return;
      }

      // First, confirm that the 'date' header is recent enough
      const requestTime = new Date(request.headers.date);
      const now = new Date();

      // If this request was made over [60] seconds ago, ignore it
      if (now - requestTime > this.settings.permittedTimestampSkew) {

        reject({
          message: `Timestamp is too old. Recieved: "${request.headers.date}" current time: "${now.toUTCString()}"`,
          code: `DATE_HEADER_INVALID`,
          time: now.toUTCString()
        });
        return;
      }

      // Great! It looks like this is a recent request, and probably not a replay attack.
      // We expect the authorization header to contain a string like this: 'signature sha256 hwbjmsdfakdj31newfdnn'

      const authorizationComponents = request.headers.authorization.split(' ');

      if (authorizationComponents.length < 3) {

        reject({
          message: `Authorization header is improperly formatted: "${request.headers.authorization}"`,
          details: `It should look like: "signature sha256 a42d7b09a929b997aa8e6973bdbd5ca94326cbffc3d06a557d9ed36c6b80d4ff"`,
          code: `AUTHORIZATION_HEADER_INVALID`,
        });
        return;
      }

      const label = authorizationComponents[0];
      const algorithm = authorizationComponents[1];
      const signature = authorizationComponents[2];

      if (label !== 'signature') {

        reject({
          message: `Authorization header is improperly formatted: "${request.headers.authorization}"`,
          details: `It should look like: "signature hmac-sha256 a42d7b09a929b997aa8e6973bdbd5ca94326cbffc3d06a557d9ed36c6b80d4ff"`,
          code: `AUTHORIZATION_HEADER_INVALID`,
        });
        return;
      }

      if (!algorithms.includes(algorithm)) {

        reject({
          message: `Authorization header send invalid algorithm: "${algorithm}". The only supported hmac algorithms are: "${algorithms.join('", "')}"`,
          code: `HMAC_ALGORITHM_INVALID`,
        });
        return;
      }

      const requestURL = url.parse(request.url);

      const canonical = canonicalize(request.method, requestURL.pathname, requestURL.query, request.headers, data);

      const calculatedSignature = sign(canonical, secret, algorithm);

      request.signature = calculatedSignature;
      request.signatureExpected = calculatedSignature;

      if (signature !== calculatedSignature) {

        reject({
          message: `Signature is invalid.`,
          code: `SIGNATURE_INVALID`
        });
        return;
      }

      // It worked!
      request.authenticated = true;

      resolve({apiKey, secret, signature});
    });
  }

  /**
   * Extract the raw body data from a request
   * @private
   * @param   {object} request - An HTTP request
   * @returns {Promise} A promise that will resolve with the raw body of the request, or a blank string
   */
  _getRawBody(request) {

    return new Promise(resolve => {

      if (request.rawBody !== undefined && request.rawBody !== null) {
        resolve(request.rawBody);
        return;
      }

      let data = '';

      request.on('data', chunk => { 
        data += chunk.toString();
      });

      request.on('end', () => {
        resolve(data);
      });
    });
  }

  /**
   * Extract the API key from a request
   * @private
   * @param   {object} request - An HTTP request
   * @returns {string} API Key, if included
   */
  _getApiKey(request) {

    let apiKey;

    if (request.headers.hasOwnProperty('x-api-key')) {

      apiKey = request.headers['x-api-key'];

    } else {

      let query = {};

      if (request.hasOwnProperty('query')) {

        query = request.query;

      } else {

        query = querystring.parse(url.parse(request.url).query);
      }

      if (query.apiKey !== undefined) {

        apiKey = query.apiKey;
      }
    }

    return apiKey;
  }

  /**
   * Retrieve the secret for an API key we got.
   * The server might have implemented this using callbacks or promises, so try both.
   * @private
   * @param   {string}  apiKey API key we received from the client
   * @returns {Promise} Promise that we got a secret for that API key from userland
   */
  _getSecretForKey(apiKey) {

    return new Promise((resolve, reject) => {

      if (typeof this.secretForKey !== 'function') {

        reject({
          message: `Missing secretForKey function`,
          details: `Please implement a 'secretForKey' delegate function`
        });
        return;
      }

      // Give up after a certain amount of time. 
      // This is to prevent situations where connections are left hanging when the client's secretForKey function has stalled
      const timer = setTimeout(() => {

        reject({
          message: `Internal failure while attempting to locate secret for API key "${apiKey}": secretForKey has timed out after ${(this.settings.secretForKeyTimeout / 1000)} seconds`,
          code: `INTERNAL_ERROR_SECRET_TIMEOUT`,
        });

      }, this.settings.secretForKeyTimeout);

      const callback = (error, secret) => {

        clearTimeout(timer);

        if (error || secret === undefined) {
          reject(error);
          return;
        }

        resolve(secret);
      };

      const possiblePromise = this.secretForKey(apiKey, callback);

      if (possiblePromise instanceof Promise) {

        possiblePromise.then(secret => {

          clearTimeout(timer);
          resolve(secret);

        }).catch(error => {

          clearTimeout(timer);
          reject(error);
        });
      }
    });
  }
}

module.exports = SimpleHMACAuth;