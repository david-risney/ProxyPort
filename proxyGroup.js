((root) => {
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
    function ProxyGroup() {
        let localMessageOutCallback;
        let localRoots = this.localRoots = {};
        let localIdToLocal = {};
        let nextLocalId = 1;
        let nextMessageId = 0;
        let messageIdToDeferral = {};

        this.proxyWrapperCallback = proxy => proxy;

        const msgProxyMethodNames = ["get", "put", "call"];

        const newProxy = id => {
            return this.proxyWrapperCallback(
                new Proxy(new MsgProxy(id), {
                    get: function(target, prop, receiver) {
                        if (msgProxyMethodNames.indexOf(prop) === -1) {
                            return target.get(prop);
                        }
                        else {
                            return target[prop];
                        }
                    },
                    set: function(target, prop, value) {
                        if (msgProxyMethodNames.indexOf(prop) === -1) {
                            return target.put(prop, value);
                        }
                        else {
                            return target[prop] = value;
                        }
                    },
                    apply: function(target, thisArg, argumentsList) {
                        return target.call(argumentsList);
                    }
                }));
        }

        function Deferral() {
            this.promise = new Promise((resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
            });
        }

        function postLocalMessageOut(message) {
            setTimeout(() => {
                localMessageOutCallback(message);
            }, 0);
        }

        function sendResponse(request, result, exception) {
            postLocalMessageOut({
                kind: "response",
                id: request.id,
                result: result ? localToValue(result) : null,
                exception: exception ? localToValue(exception) : null
            });
        }

        function localToValue(local) {
            if (typeof local === typeof "" || typeof local === typeof 1) {
                return {
                    kind: "literal",
                    value: local
                };
            }
            else {
                let localId = nextLocalId++;
                localIdToLocal[localId] = local;
                return {
                    kind: "proxy",
                    value: localId
                };
            }
        }

        function valueToLocal(value) {
            switch (value.kind) {
                case "literal":
                    return value.value;
                case "proxy":
                    return newProxy(value.value);
            }
            throw new Error("Unknown value kind.");
        }

        function MsgProxy(id) {
            this.call = function (arguments) {
                let messageId = nextMessageId++;
                messageIdToDeferral[messageId] = new Deferral();
                postLocalMessageOut({
                    kind: "request",
                    id: messageId,
                    localId: id,
                    command: "call",
                    values: (arguments || []).map(localToValue)
                });
                return messageIdToDeferral[messageId].promise;
            };
            this.get = function (name) {
                let messageId = nextMessageId++;
                messageIdToDeferral[messageId] = new Deferral();
                postLocalMessageOut({
                    kind: "request",
                    id: messageId,
                    localId: id,
                    command: "get",
                    values: [localToValue(name)]
                });
                return messageIdToDeferral[messageId].promise;
            };
            this.put = function (name, value) {
                let messageId = nextMessageId++;
                messageIdToDeferral[messageId] = new Deferral();
                postLocalMessageOut({
                    kind: "request",
                    id: messageId,
                    localId: id,
                    command: "get",
                    values: [localToValue(name), localToValue(value)]
                });
                return messageIdToDeferral[messageId].promise;
            };
        }

        // Hardcoded 0 for the ProxyGroup localRoots access.
        let remoteRoots = this.remoteRoots = newProxy(0);
        localIdToLocal[0] = localRoots;

        this.setLocalMessageOutCallback = function (callback) {
            localMessageOutCallback = callback;
        }

        this.remoteMessageIn = function (message) {
            switch (message.kind) {
                case "request":
                    let local = localIdToLocal[message.localId];
                    switch (message.command) {
                        case "call":
                            try {
                                let result = local.apply(null, message.values.map(valueToLocal));
                                sendResponse(message, result, null);
                            }
                            catch (err) {
                                sendResponse(message, null, err);
                            }
                            break;

                        case "get":
                            try {
                                let result = local[valueToLocal(message.values[0])];
                                sendResponse(message, result, null);
                            }
                            catch (err) {
                                sendResponse(message, null, err);
                            }
                            break;

                        case "put":
                            try {
                                let result = local[valueToLocal(message.values[0])] = valueToLocal(message.values[1]);
                                sendResponse(message, result, null);
                            }
                            catch (err) {
                                sendResponse(message, null, err);
                            }
                            break;
                    }
                    break;
                case "response":
                    if (message.result) {
                        messageIdToDeferral[message.id].resolve(valueToLocal(message.result));
                    }
                    else if (message.exception) {
                        messageIdToDeferral[message.id].reject(valueToLocal(message.exception));
                    }
                    delete messageIdToDeferral[message.id];
                    break;
            }
        }
    }

    root.ProxyGroup = ProxyGroup;
})(this);