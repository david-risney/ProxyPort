((root) => {
    // Helper object that makes it easy to hand out a promise and later resolve or rejec it.
    function Deferral(promise) {
        if (!promise) {
            this.promise = new Promise((resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
            });
        }
        else {
            this.promise = Promise.resolve(promise);
            this.resolve = () => {};
            this.reject = () => {};
        }

        this.then = this.promise.then.bind(this.promise);
    }

    // A map from id to promise of a value.
    // get returns a promise.
    // set resolves or rejects the promise.
    function PromiseMap() {
        const idToValues = {};
        this.get = id => {
            if (!idToValues[id]) {
                idToValues[id] = new Deferral();
            }
            return idToValues[id].promise;
        };
        this.set = (id, value, exception) => {
            if (!idToValues[id]) {
                idToValues[id] = new Deferral();
            }
            if (value) {
                idToValues[id].resolve(value);
            }
            else {
                idToValues[id].reject(exception);
            }
        };
    }

    // message (request)
    //      kind -> request / response
    //      id -> message id (new request id)
    //      localId -> int of proxy target
    //      command -> call / get / put
    //      values -> array( value )
    //
    // message (response)
    //      kind -> response
    //      id -> message id (response id matching previous request id)
    //      result -> value
    //      exception -> value
    //
    // value
    //      literal -> string / number
    //      proxy -> int of proxy target
    function ProxyGroup(options) {
        // An optional global ID prefix. Useful for debugging.
        const gid = options.gid || "";
        // An optional console object. If provided, its log method is used to log messages.
        const log = options.console ? options.console.log.bind(options.console) : () => {};

        // The caller sets this to a callback that receives JS objects that should be sent
        // to the remote ProxyGroup.
        let localMessageOutCallback;

        // The caller adds properties to localRoots to have those exposed to the remote side.
        const localRoots = this.localRoots = {};
        // Map from id to promise of a local object.
        const localsMap = new PromiseMap();
        // Map from id to message response.
        const messageMap = new PromiseMap();
        // Request messages and response messages share an ID.
        // The proxy object representing the result of a response message also shares the
        // message ID.
        // Objects added to the localsMap not via a request message get their own ID via
        // nextId.

        // function that returns unique IDs.
        const nextId = (() => {
            let id = 1;
            return {
                nextId: (prefix) => gid + (prefix || "") + id++
            };
        })().nextId;

        function postLocalMessageOut(message) {
            log(gid + ": (out) " + JSON.stringify(message));

            setTimeout(() => { localMessageOutCallback(message); }, 0);
        }

        function sendResponse(request, result, exception) {
            postLocalMessageOut({
                kind: "response",
                id: request.id,
                result: result ? localToValue(result, request.id) : null,
                exception: exception ? localToValue(exception, request.id) : null
            });
        }

        function sendRequest(request) {
            postLocalMessageOut({
                kind: "request",
                id: request.id,
                localId: request.localId,
                command: request.command,
                values: (request.values || []).map(localToValue)
            });
        }

        // Creates a ProxyGroup Proxy object. This has two parts, an external JS Proxy and an internal MsgProxy.
        // The internal MsgProxy supports get, put, call, and settle. The JS Proxy maps all implicit Proxy trapped 
        // get, put, and calls to the explicit corresponding internal methods.
        const newProxy = localId => {
            const newProxyInternal = localId => {
                // Use a function as the base so that the JS Proxy can trap method calls.
                let msgProxy = () => {};

                const sendRequestHelper = (command, values) => {
                    let messageId = nextId("msg");
                    sendRequest({
                        id: messageId,
                        localId,
                        command,
                        values,
                    });
                    return newProxy(messageId);
                };

                msgProxy.call = arguments => sendRequestHelper("call", arguments);
                msgProxy.get = name => sendRequestHelper("get", [name]);
                msgProxy.put = (name, value) => sendRequestHelper("put", [name, value]);

                msgProxy.settle = (resolve, reject) => {
                    return messageMap.get(localId).then(response => {
                        if (response.result && response.result.kind === "proxy") {
                            // Note we're returning the internal proxy here. If we return the external
                            // then we're returning the same thenable out of its own then which leads
                            // to an infinite loop.
                            return msgProxy; 
                        }
                        else if (response.result && response.result.kind === "literal") {
                            return valueToLocal(response.result);
                        }
                        else if (response.exception) {
                            let err = new Error("Response exception");
                            err.originalIssue = valueToLocal(response.exception);
                            throw err;
                        }
                        throw new Error("Unknown resposne kind");
                    }).then(resolve, reject);
                };

                return msgProxy;
            }

            const externalProxy = new Proxy(newProxyInternal(localId), {
                get: (target, prop, receiver) => {
                    if (prop === "then") {
                        return target["settle"];
                    }
                    else if (target.hasOwnProperty(prop)) {
                        return target[prop];
                    }
                    return target.get(prop);
                },
                set: (target, prop, value) => {
                    if (target.hasOwnProperty(prop)) {
                        return target[prop] = value;
                    }
                    return target.put(prop, value);
                },
                apply: (target, thisArg, argumentsList) => {
                    return target.call(argumentsList);
                }
            });

            return externalProxy;
        }

        // Serialize a local object to a remote wire value.
        function localToValue(local, suggestedId) {
            if (typeof local === typeof "" || typeof local === typeof 1) {
                return { kind: "literal", value: local };
            }
            else {
                let localId = suggestedId || nextId("local");
                localsMap.set(localId, local);
                return { kind: "proxy", value: localId };
            }
        }

        // Deserialize a remote wire value to a local object.
        function valueToLocal(value) {
            switch (value.kind) {
            case "literal":
                return value.value;
            case "proxy":
                return newProxy(value.value);
            }
            throw new Error("Unknown value kind.");
        }

        // Hardcoded ID for the ProxyGroup localRoots object.
        // This is hardcoded to avoid any initialization messages.
        const rootId = "_globalroot";
        // We just create the proxy to represent the remote side's localRoots.
        let remoteRoots = this.remoteRoots = newProxy(rootId);
        // And we add our own localRoots object to our localsMap.
        localsMap.set(rootId, localRoots);

        this.setLocalMessageOutCallback = callback => {
            localMessageOutCallback = callback;
        }

        // The caller uses this to provide messages from the remote side to this
        // object.
        this.remoteMessageIn = message => {
            log(gid + ": (in) " + JSON.stringify(message));

            switch (message.kind) {
            case "request": // A remote message has requested us do something.
                // Get the promise of the local object that the message is targeting.
                // This lets the remote side queue up requests on a local object that
                // we haven't finished creating yet. That's why we use the request
                // message ID as the local object ID, so that future request messages
                // can know the ID of the result of a request before the original
                // request is complete.
                localsMap.get(message.localId).then(local => {
                    try {
                        let result;
                        switch (message.command) {
                        case "call":
                            result = local.apply(null, message.values.map(valueToLocal));
                            break;

                        case "get":
                            result = local[valueToLocal(message.values[0])];
                            break;

                        case "put":
                            result = local[valueToLocal(message.values[0])] = valueToLocal(message.values[1]);
                            break;
                        }
                        sendResponse(message, result, null);
                    } catch (err) {
                        sendResponse(message, null, err);
                    }
                });
                break;

            case "response":
                messageMap.set(message.id, message);
                break;

            default:
                throw new Error("Unknown message kind " + message.kind);
            }
        }
    }

    root.ProxyGroup = ProxyGroup;
})(this);