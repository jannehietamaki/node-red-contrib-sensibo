
const rp = require('request-promise-native')
const promiseRetry = require('promise-retry')
const _ = require('lodash')

const apiRoot = 'https://home.sensibo.com/api/v2'

module.exports = function (RED) {
  const request = (method, url, options) => {
    return promiseRetry({ minTimeout: 5 }, (retry, number) => {
      if (number > 1) {
        console.log('retrying...', number)
      }
      return rp[method](url, options).catch(retry)
    })

      .catch((error) => {
        throw error
      })
  }

  const getNames = (key) => {
    return request('get', apiRoot + '/users/me/pods', {
      qs: {
        apiKey: key,
        fields: 'id,room'
      },
      json: true
    })

      .then((pods) => {
        // Test harness with two pods
        // pods = {"status":"success","result":[{"id":"KN6PnUwG","room":{"name":"Living Room","icon":"lounge"}},{"id":"2NDPOD","room":{"name":"Bedroom","icon":"lounge"}}]}
        var results = []
        _.forEach(pods.result, function (pods, index) {
          const item = {}
          item.value = pods.id
          item.label = pods.room.name
          // item ["podID"] = pods.id;
          // item ["podName"] = pods.room.name;
          results.push(item)
        })
        return results
      })
  }

  const getMeasurements = (key, podname) => {
    return request('get', apiRoot + '/pods/' + podname + '/measurements/', {
      qs: {
        apiKey: key
      },
      json: true
    })

      .then((meas) => {
        return meas
      })
  }

  const getConfig = (key, podname) => {
    return request('get', apiRoot + '/pods/' + podname, {
      qs: {
        apiKey: key,
        fields: '*'
      },
      json: true
    })

      .then((meas) => {
        return meas
      })
  }

  const patchPods = (key, id, patch) => {
    const qs = {
      apiKey: key,
      fields: 'acState'
    }

    console.log('Patching pod:' + id + ' with API key ' + key)
    return request('get', apiRoot + '/pods/' + id, { qs, json: true, timeout: 5000 })
      .then((data) => {
        console.log('Old state', data.result);
        return changeState(key, id, data.result.acState, patch)
      })
  }

  // WARNING: This method modifies the acState object in place
  const changeState = (apiKey, id, acState, patch) => {
    const qs = { apiKey }
    acState = _.merge(acState, patch)
    console.log('changeState', id, acState);
    return request('post', apiRoot + '/pods/' + id + '/acStates', { qs, body: { acState }, json: true })
  }

  function sensiboGet (config) {
    RED.nodes.createNode(this, config)
    // Set the node equal to to top level of this for use in functions
    var node = this
    node.api = RED.nodes.getNode(config.sensiboAPI)

    this.on('input', function (msg, send, done) {
      // If this is pre-1.0, 'send' will be undefined, so fallback to node.send
      send = send || function () { node.send.apply(node, arguments) }
      this.status({ fill: 'green', shape: 'ring', text: 'polling' })

      // Lets call our new generic routines - handy location to also test code
      // var testcall = getNames(node.api.sensibo_api);
      // testcall.then( (names) => console.log('Got pod names:', JSON.stringify(names)))

      if (config.getconfig) {
        // Do the call to Sensibo for config oly as a promise and prepare message
        getConfig(node.api.sensibo_api, config.pod)
          .then(function (cfg) {
            node.status({ fill: 'green', shape: 'dot', text: 'waiting' })
            send(cfg)
            // Check done exists (1.0+)
            if (done) {
              done()
            }
          })
          .catch(function (err) {
            // grab the error messasge and send as payload.
            msg.payload = err.message
            node.status({ fill: 'red', shape: 'dot', text: 'error' })
            send(msg)
            if (done) {
              // Use done if defined (1.0+)
              done(err)
            } else {
              // Fallback to node.error (pre-1.0)
              node.error(err, msg)
            }
          })
      } else {
        // Do the call to Sensibo as a promise and prepare message
        getMeasurements(node.api.sensibo_api, config.pod)
          .then(function (meas) {
            msg.temperature = meas.result[0].temperature
            msg.humidity = meas.result[0].humidity
            msg.secondsAgo = meas.result[0].time.secondsAgo
            msg.time = meas.result[0].time.time
            msg.payload = meas.status
            node.status({ fill: 'green', shape: 'dot', text: 'waiting' })
            send(msg)
            // Check done exists (1.0+)
            if (done) {
              done()
            }
          })
          .catch(function (err) {
            // grab the error messasge and send as payload.
            msg.payload = err.message
            node.status({ fill: 'red', shape: 'dot', text: 'error' })
            send(msg)
            if (done) {
              // Use done if defined (1.0+)
              done(err)
            } else {
              // Fallback to node.error (pre-1.0)
              node.error(err, msg)
            }
          })
      }
    })

    this.on('close', function (removed, done) {
      if (removed) {
        if (node.interval_id !== null) {
          clearInterval(node.interval_id)
        }

        console.log('Sensibo - The node and timer has been deleted')
      } else {
        // Not sure if this is needed #TODO when would a node be restarted
        // console.log('Sensibo - The node has been restarted')
      }
      done()
    })

    // Only set interval time if one has been set.
    if (config.polltime > 0) {
      // First check if we have already have a timer and cancel
      if (node.interval_id !== null) {
        clearInterval(node.interval_id)
      }
      // send trace message for testing framework
      node.trace('creating timer')
      node.interval_id = setInterval(function () {
        // Setup a timer if required
        node.emit('input', {})
      }
      // Set the timer from the configuration page and convert to millisecond
      , config.polltime * 1000)
    } else if (config.polltime === 0) {
      if (node.interval_id !== null) {
        // Kill old timer should it exist and we change to 0 polling
        clearInterval(node.interval_id)
      }
    }
  }

  function sensiboSend (config) {
    RED.nodes.createNode(this, config)

    var node = this
    node.api = RED.nodes.getNode(config.sensiboAPI)

    node.on('input', function (msg, send, done) {
      // If this is pre-1.0, 'send' will be undefined, so fallback to node.send
      send = send || function () { node.send.apply(node, arguments) }

      this.status({ fill: 'green', shape: 'ring', text: 'sending' })
      node = this
      // parse message
      console.log('Input message is:' + JSON.stringify(msg))

      const cmdData = {}
      // #TODO - Map against possible values and validate

      if (typeof msg.on !== 'undefined') {
        if (msg.on === 'true') {
          cmdData.on = true
        } else {
          cmdData.on = false
        };
      };

      if (typeof msg.swing !== 'undefined') {
        cmdData.swing = msg.swing
      };
      if (typeof msg.mode !== 'undefined') {
        cmdData.mode = msg.mode
      };
      if (typeof msg.fanlevel !== 'undefined') {
        cmdData.fanLevel = msg.fanlevel
      };
      if (typeof msg.targetTemperature !== 'undefined') {
        cmdData.targetTemperature = msg.targetTemperature
      };

      console.log('Compiled Command is:' + JSON.stringify(cmdData))

      var performPatch = patchPods(node.api.sensibo_api, config.pod, cmdData)
        .then((cmdData) => {
          msg.payload = cmdData
          node.status({ fill: 'green', shape: 'dot', text: 'connected' })
          send(msg)
          // Check done exists (1.0+)
          if (done) {
            done()
          }
        })

        .catch(function (err) {
          // grab the error messasge and send as payload.
          msg.payload = err.message
          // Report back the error
          if (done) {
            // Use done if defined (1.0+)
            done(err)
          } else {
            // Fallback to node.error (pre-1.0)
            node.error(err, msg)
          }

          node.status({ fill: 'red', shape: 'dot', text: 'error' })
          send(msg)
        })
    })
  }

  function sensiboConfig (n) {
    RED.nodes.createNode(this, n)
    this.sensibo_api = n.senAPI
    // Create the admin server here so we have access to API Key.
    RED.httpAdmin.get('/sensibo', RED.auth.needsPermission('serial.read'), function (req, res) {
      // get the query string
      const retrieveType = req.query.lkup
      console.log('Type of data to retrieve is ' + retrieveType)
      getNames(n.senAPI)
        .then(function (pods) {
          console.log('Sending back pods ' + pods)
          res.json(pods)
        })
        .catch(function (err) {
          // Error Handler
          console.log('Sensibo Admin lookup failed with' + err)
        })
    }) // end of RED.http
  }

  RED.nodes.registerType('sensibo-config', sensiboConfig)
  RED.nodes.registerType('sensibo in', sensiboGet)
  RED.nodes.registerType('sensibo send', sensiboSend)
}
