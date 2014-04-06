(function (root) {
    "use strict";

    var Q,
        SAT,
        runConsoleTests = false;

    if (typeof document !== "undefined") {
        Q = root.Q;
        SAT = root.SAT;
        document.addEventListener("DOMContentLoaded", function () {
            new SAT.ConsoleView(console);
            new SAT.HtmlView(document.getElementsByTagName("body")[0]);
        });
    }
    else if (typeof require !== "undefined") {
        SAT = require("../../simpleAsyncTester");
        Q = require("../../q");
        runConsoleTests = true;
    }

    var Promise = {
        delay: undefined,
        wrap: undefined,
        wrapError: undefined,
        defer: undefined
    };

    if (typeof WinJS !== "undefined") {
        Promise.delay = WinJS.Promise.timeout;
        Promise.wrap = WinJS.Promise.wrap;
        Promise.wrapError = WinJS.Promise.wrapError;
        Promise.defer = function () {
            var resolve,
                reject,
                notify,
                promise = new root.WinJS.Promise(function (resolveIn, rejectIn, notifyIn) {
                    resolve = resolveIn;
                    reject = rejectIn;
                    notify = notifyIn;
                });

            return {
                promise: promise,
                resolve: resolve,
                reject: reject,
                notify: notify
            };
        }
    }
    else {
        Promise.defer = Q.defer;
        Promise.delay = Q.delay;
        Promise.wrap = Q;
        Promise.wrapError = Q.reject;
    }

    function createProxyPortsOnChannel(console, options) {
        var channel = new MessageChannel();
        channel.port1.start();
        channel.port2.start();
        return {
            port1: new ProxyPort(new ProxyPort.MessagePortWithLogging(channel.port1, console.log.bind(console)), options),
            port2: new ProxyPort(channel.port2, options)
        };
    }

    SAT.addTest("ProxyPort post simple number", function (console) {
        var channel = createProxyPortsOnChannel(console),
            result;

        channel.port2.addEventListener("object", function (object) {
            result = object;
        });
        channel.port1.postObject(1);

        return Promise.delay(100).then(function () {
            console.assert(result === 1 && typeof result === "number");
        });
    });

    SAT.addTest("ProxyPort post two strings", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [];

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject("first");
        channel.port1.postObject("second");

        return Promise.delay(100).then(function () {
            console.assert(results[0] === "first");
            console.assert(results[1] === "second");
        });
    });

    SAT.addTest("ProxyPort post array of arrays of numbers", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            value = [[1, 2, 3], [4], [[5], 6]];

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(value);

        return Promise.delay(100).then(function () {
            console.log("received: " + JSON.stringify(results[0]));
            console.log("expected: " + JSON.stringify(value));
            console.assert(JSON.stringify(results[0]) === JSON.stringify(value));
        });
    });

    SAT.addTest("ProxyPort post object of null like values", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            value = {n: null, u: undefined, z: 0, f: false};

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(value);

        return Promise.delay(100).then(function () {
            console.log("received: " + JSON.stringify(results[0]));
            console.log("expected: " + JSON.stringify(value));
            console.assert(JSON.stringify(results[0]) === JSON.stringify(value));
            console.assert(results[0].hasOwnProperty("u") && results[0].u === undefined);
        });
    });

    SAT.addTest("ProxyPort post undefined", function (console) {
        var channel = createProxyPortsOnChannel(console),
            deferral = Promise.defer();

        channel.port2.addEventListener("object", function (object) {
            console.assert(object === undefined);
            deferral.resolve();
        });
        channel.port1.postObject(undefined);

        return deferral.promise;
    });

    SAT.addTest("ProxyPort post null", function (console) {
        var channel = createProxyPortsOnChannel(console),
            deferral = Promise.defer();

        channel.port2.addEventListener("object", function (object) {
            console.assert(object === null);
            deferral.resolve();
        });
        channel.port1.postObject(null);

        return deferral.promise;
    });

    SAT.addTest("ProxyPort post array like object containing array", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            value = { 0: "a", 1: ["b", "c"], length: 2 };

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(value);

        return Promise.delay(100).then(function () {
            console.log("received: " + JSON.stringify(results[0]));
            console.log("expected: " + JSON.stringify(value));
            console.assert(JSON.stringify(results[0]) === JSON.stringify(value));
        });
    });

    SAT.addTest("ProxyPort post sequence of various objects", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [1, ["a", { b: "b" }, 3], { a: "b" }, "abc", null];

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            console.log("received: " + JSON.stringify(results));
            console.log("expected: " + JSON.stringify(values));
            console.assert(JSON.stringify(results) === JSON.stringify(values));
        });
    });

    SAT.addTest("ProxyPort post object with cycles", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            obj = { a: undefined };

        obj.a = obj;
        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            console.assert(results[0].hasOwnProperty("a") && results[0].a === results[0]);
            console.assert(values[0].hasOwnProperty("a") && values[0].a === values[0]);
        });
    });

    SAT.addTest("ProxyPort post function", function (console) {
        var channel = createProxyPortsOnChannel(console),
            called = false,
            deferral = Promise.defer();

        channel.port2.addEventListener("object", function (fn) {
            fn().then(function () {
                console.assert(called);
                deferral.resolve();
            });
        });
        channel.port1.postObject(function () { called = true; });

        return deferral.promise;
    });

    SAT.addTest("ProxyPort post object with simple function", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = { a: function () { return ++count; } };

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            console.assert(result === 1);
            return results[0].a();
        }).then(function (result) {
            console.assert(result === 2);
            console.assert(result === count);
        });
    });

    SAT.addTest("ProxyPort post object with simple throwing function", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = { a: function () { throw new Error("Always fail"); } },
            success = true;

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            success = true;
        }, function (fail) {
            success = false;
        }).then(function () {
            console.assert(!success);
        });
    });

    SAT.addTest("ProxyPort post object with promise failing function", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = { a: function () { return Promise.wrapError(456); } },
            success = true;

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            success = true;
        }, function (fail) {
            console.assert(fail === 456);
            success = false;
        }).then(function () {
            console.assert(!success);
        });
    });

    SAT.addTest("ProxyPort post object with promise function", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            obj = { a: function () { return Promise.wrap(123); } };

        values.push(obj);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            return results[0].a();
        }).then(function (result) {
            console.assert(result === 123);
        });
    });

    SAT.addTest("ProxyPort post object called through object function", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            objA = { a: function () { return ++count; } },
            objB = { b: function (obj) { return obj.a(); } };

        values.push(objB);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            return results[0].b(objA);
        }).then(function (result) {
            console.assert(result === 1);
        });
    });

    SAT.addTest("ProxyPort post proxy unproxying", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            values = [],
            count = 0,
            objA = { a: function (obj) { return obj; } },
            objB = { "abc": 123 };

        values.push(objA);

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        values.forEach(channel.port1.postObject.bind(channel.port1));

        return Promise.delay(100).then(function () {
            return results[0].a(objB);
        }).then(function (result) {
            console.assert(objB.abc === 123);
            console.log("objB looks correct, but is it exactly the same object?");
            console.assert(objB === result);
        });
    });

    SAT.addTest("ProxyPort limit object depth", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            obj = { a: { b: { c: { d: { e: 7 } } } } };

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(obj, { maximumDepth: 3 });

        return Promise.delay(100).then(function () {
            console.assert(JSON.stringify(results[0]) === JSON.stringify({ a: { b: {} } }));
        });
    });

    SAT.addTest("ProxyPort inherit object depth", function (console) {
        var channel = createProxyPortsOnChannel(console),
            results = [],
            objA = { a: { b: { c: { d: { e: 7 } } } }, r: function () { return objB; } },
            objB = { f: { g: { h: { i: { j: 7 } } } } };

        channel.port2.addEventListener("object", function (object) {
            results.push(object);
        });
        channel.port1.postObject(objA, { maximumDepth: 3 });

        return Promise.delay(100).then(function () {
            console.log(JSON.stringify(results[0]));
            console.assert(JSON.stringify(results[0]) === JSON.stringify({ a: { b: {} } }));
            return results[0].r();
        }).then(function (obj) {
            console.log(JSON.stringify(obj));
            console.assert(JSON.stringify(obj) === JSON.stringify({ f: { g: {} } }));
        });
    });

    SAT.addTest("ProxyPort cleanup one proxy", function (console) {
        var channel = createProxyPortsOnChannel(console),
            deferral = Promise.defer(),
            garbage = { a: "b" };

        channel.port1.addEventListener("objectRemoved", function (key) { deferral.resolve(); });
        channel.port2.addEventListener("object", function (object) { channel.port2.closeProxyGroup(object); });
        channel.port1.postObject(garbage);

        return deferral.promise;
    });

    SAT.addTest("ProxyPort cleanup two proxies on both sides", function (console) {
        var channel = createProxyPortsOnChannel(console),
            deferral = Promise.defer(),
            removedCount = 0,
            expectedRemoveCount = 3,
            obj = {
                run: function (workItemProxy) {
                    return workItemProxy(this); // this (proxies not reused) - o87
                }
            }; // obj - o81

        function onRemove(debugName, key) {
            console.log(debugName + ": " + key);
            ++removedCount;
            console.assert(removedCount <= expectedRemoveCount);
            if (removedCount === expectedRemoveCount) {
                deferral.resolve();
            }
        }

        channel.port1.addEventListener("objectRemoved", onRemove.bind(null, "port1 objectRemoved"));
        channel.port2.addEventListener("objectRemoved", onRemove.bind(null, "port2 objectRemoved"));

        channel.port2.addEventListener("object", function (objProxy) {
            objProxy.run(function workItem(objProxy) { // workItem - o84
                channel.port2.closeProxyGroup(objProxy);
            });
        });
        channel.port1.postObject(obj);

        // port1 local side            | port2 local side
        // postObject obj           -> | -> objProxy81
        // obj.run(workItemProxy84) <- | <- objProxy81.run(workItem)
        // workItemProxy84(obj)     -> | -> workItem(objProxy87)

        return deferral.promise;
    });

    SAT.addTest("ProxyWorker create, use, and close", function (console) {
        return ProxyPort.createProxyWorkerAsync(["q.js"], { get: "$", proxyPortUri: "../../proxyPort.js", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            console.log(result.root.location.href);
            console.assert(result.root.location.pathname.indexOf("proxyPort.js") !== -1);
            result.client.close();
        });
    });

    SAT.addTest("ProxySandbox create, use, and close", function (console) {
        return ProxyPort.createProxySandboxAsync(["q.js"], { get: "$.document.location", proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            console.log(result.root.href);
            console.assert(result.root.pathname.indexOf("proxyPortSandbox.html") !== -1);
            result.client.close();
        });
    });

    SAT.addTest("ProxySandbox JSONP callback success", function (console) {
        var client;
        return ProxyPort.createProxySandboxAsync(["q.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/browser-q/jsonp-example-callback.jsonp", { callbackName: "foo" });
        }).then(function (jsonpObj) {
            console.assert(jsonpObj.length);
            client.close();
        });
    });

    SAT.addTest("ProxySandbox JSONP global success", function (console) {
        var client;
        return ProxyPort.createProxySandboxAsync(["q.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/browser-q/jsonp-example-global.jsonp", { globalName: "foo" });
        }).then(function (jsonpObj) {
            console.assert(jsonpObj.length);
            client.close();
        });
    });

    SAT.addTest("ProxySandbox JSONP throw failure", function (console) {
        var client;
        return ProxyPort.createProxySandboxAsync(["q.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/browser-q/jsonp-example-throw.jsonp", { globalName: "foo" });
        }).then(function (jsonpObj) {
            console.assert(false);
        }, function (error) {
            console.log("Jsonp expected failure: " + error);
            client.close();
        });
    });

    SAT.addTest("ProxySandbox JSONP callback fails to callback", function (console) {
        var client;
        return ProxyPort.createProxySandboxAsync(["q.js"], { proxyPortSandboxUri: "../../proxyPortSandbox.html", debugConsoleLog: console.log.bind(console) }).then(function (result) {
            client = result.client;
            return ProxyPort.getJsonpAsync(result.client, "test/browser-q/jsonp-example-global.jsonp", { callbackName: "foo" });
        }).then(function (jsonpObj) {
            console.assert(false);
            client.close();
        }, function (error) {
            console.log("Jsonp expected failure: " + error);
            client.close();
            return "success";
        });
    });

    if (runConsoleTests) {
        new SAT.ConsoleView(console, SAT);
        SAT.runAsync().then(function () {
            console.log("done");
        },
        function (error) {
            console.log("Error in test tester: " + error);
        });
    }
})(this);