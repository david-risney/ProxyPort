(function (root) {
    "use strict";

    var SAT;

    SAT = root.SAT;

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
        Promise.defer = function (onCancel) {
            var resolve,
                reject,
                notify,
                promise = new root.WinJS.Promise(function (resolveIn, rejectIn, notifyIn) {
                    resolve = resolveIn;
                    reject = rejectIn;
                    notify = notifyIn;
                }, onCancel);

            return {
                promise: promise,
                resolve: resolve,
                reject: reject,
                notify: notify
            };
        }
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

    SAT.addTest("ProxyPort cancel promise", function (console) {
        var channel = createProxyPortsOnChannel(console),
            cancelled = false,
            deferral = Promise.defer();

        channel.port2.addEventListener("object", function (object) {
            var promise = object.fn(function () { });
            promise.cancel();
        });
        channel.port1.postObject({
            fn: function (complete) {
                var innerDeferral = Promise.defer(function () {
                    console.log("cancelling...");
                    cancelled = true;
                    complete().then(function () { deferral.resolve(); });
                });
                return innerDeferral.promise;
            }
        });

        return deferral.promise.then(function () { console.assert(cancelled, "should have cancelled."); });
    });
})(this);