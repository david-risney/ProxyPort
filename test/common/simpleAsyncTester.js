// The MIT License (MIT)
//
// Copyright (c) 2014 David Risney
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
(function (root) {
    "use strict";

    // Normalize non-standrad promise methods from dependency promise libraries.
    var Promise = (function () {
        var Promise = {},
            Q;

        if (typeof WinJS !== "undefined") {
            Promise.wrap = WinJS.Promise.wrap;
            Promise.wrapError = WinJS.Promise.wrapError;
        }
        else if (typeof root.Q !== "undefined") {
            Promise.wrap = root.Q;
            Promise.wrapError = root.Q.reject;
        }
        else if (typeof require !== "undefined") {
            Q = require("./q");
            Promise.wrap = Q;
            Promise.wrapError = Q.reject;
        }
        else {
            throw new Error("SimpleAsyncTester depends upon WinJS or Q to provide a promise implementation.");
        }

        return Promise;
    })();

    // Generic event source creation helper.
    var EventTarget = function(target, eventTypes) {
        var eventTypeToHandlers = {}; // Map from event type name string to array of event handlers.

        if (!(this instanceof EventTarget)) {
            throw new Error("EventTarget is a constructor and must be called with new.");
        }

        function validateEventType(eventType) {
            if (!eventTypes.some(function (comparisonEventType) { return eventType === comparisonEventType; })) {
                throw new Error("Event type " + eventType + " not supported. Must be one of " + eventTypes.join(", "));
            }
        }

        function addEventListener(eventType, eventHandler) {
            validateEventType(eventType);
            if (!eventTypeToHandlers.hasOwnProperty(eventType)) {
                eventTypeToHandlers[eventType] = [];
            }
            eventTypeToHandlers[eventType].push(eventHandler);
        }

        function removeEventListener(eventType, eventHandler) {
            validateEventType(eventType);
            if (eventTypeToHandlers.hasOwnProperty(eventType)) {
                eventTypeToHandlers[eventType] = eventTypeToHandlers[eventType].filter(function (comparisonEventHandler) {
                    return comparisonEventHandler !== eventHandler;
                });
            }
        }

        function dispatchEvent(eventType, eventArg) {
            validateEventType(eventType);
            if (eventTypeToHandlers.hasOwnProperty(eventType)) {
                eventTypeToHandlers[eventType].forEach(function (eventHandler) {
                    eventHandler.call(null, eventArg);
                });
            }
            if (target["on" + eventType]) {
                target["on" + eventType].call(null, eventArg);
            }
        }
        this.dispatchEvent = dispatchEvent.bind(this);

        target.addEventListener = addEventListener.bind(this);
        target.removeEventListener = removeEventListener.bind(this);
        eventTypes.forEach(function (eventType) {
            if (!target.hasOwnProperty("on" + eventType)) {
                target["on" + eventType] = null;
            }
        });

        eventTypes.map(function (eventType) {
            return {
                name: "dispatch" + eventType[0].toUpperCase() + eventType.substr(1) + "Event",
                fn: dispatchEvent.bind(this, eventType)
            };
        }.bind(this)).forEach(function (dispatchEntry) {
            this[dispatchEntry.name] = dispatchEntry.fn;
        }.bind(this));
    };

    // Logger passed to the test functions that implements assert etc.
    var Logger = function (test, eventTarget) {
        var that = this;

        function log(level, text, context) {
            var message = {
                level: level,
                text: text,
                test: test,
                time: Date.now(),
                context: context
            };
            eventTarget.dispatchMessageAddedEvent(message);
        }

        this.assert = function (condition, message) {
            var error;
            message = message || "Assertion failure";

            if (!condition) {
                error = new Error(message);
                error.test = test;
                error.time = Date.now();
                that.error(message, error);
                throw error;
            }
        }

        this.info = this.log = log.bind(this, "info");
        this.warn = log.bind(this, "warn");
        this.error = log.bind(this, "error");
    }

    var SimpleAsyncTester = function () {
        if (!this instanceof SimpleAsyncTester) {
            throw new TypeError("SimpleAsyncTester is a constructor and must be called with new.");
        }
        var eventTarget = new EventTarget(this, ["messageAdded", "messagesCleared", "testStarted", "testCompleted"]),
            tests = [],
            runningTestsPromise = null;

        this.addTest = function (name, test) {
            tests.push({
                name: name,
                test: test,
                idx: tests.length
            });
        }

        this.runAsync = function (filterFn) {
            filterFn = filterFn || function () { return true; };

            var createPromiseFromTest = function(test) {
                var promise,
                    logger = new Logger(test, eventTarget);

                try {
                    eventTarget.dispatchTestStartedEvent({ test: test, name: test.name, time: Date.now() });
                    test.complete = false;
                    promise = Promise.wrap(test.test(logger));
                }
                catch (error) {
                    promise = Promise.wrapError(error);
                }

                return promise.then(
                    function () {
                        eventTarget.dispatchTestCompletedEvent({ test: test, name: test.name, time: Date.now(), status: SAT.success });
                    },
                    function (error) {
                        eventTarget.dispatchTestCompletedEvent({ test: test, name: test.name, time: Date.now(), status: SAT.fail, error: error });
                    });
            }

            if (!runningTestsPromise) {
                eventTarget.dispatchMessagesClearedEvent();

                runningTestsPromise = tests.
                    filter(filterFn).
                    map(function (test) { return createPromiseFromTest.bind(undefined, test); }).
                    reduce(function (lastPromise, nextPromiseFn) { return lastPromise.then(nextPromiseFn); }, Promise.wrap()).
                    then(function () { runningTestsPromise = null; });
            }
            return runningTestsPromise;
        }
    }
    var SAT = new SimpleAsyncTester();
    SAT.SimpleAsyncTester = SimpleAsyncTester;
    SAT.success = "success";
    SAT.fail = "fail";

    SAT.ConsoleView = function (console, tester) {
        tester = tester || SAT;
        if (!this instanceof SAT.ConsoleView) {
            throw new TypeError("SAT.ConsoleView is a constructor and must be called with new");
        }
        tester.addEventListener("testStarted", function (args) {
            console.log(args.name + ": started");
        });
        tester.addEventListener("testCompleted", function (args) {
            if (args.status === SAT.success) {
                console.log(args.name + ": succeeded");
            }
            else {
                console.error(args.name + ": failed: " + args.error);
            }
        });
        tester.addEventListener("messageAdded", function (args) {
            var text = args.name + ": " + args.text;
            switch (args.level) {
                case "info":
                    console.info(text);
                    break;
                case "warn":
                    console.warn(text);
                    break;
                case "error":
                    console.error(text);
                    break;
                default:
                    throw new Error("Unknown level type: " + args.level);
            }
        });
    }

    SAT.HtmlView = function (root, tester) {
        tester = tester || SAT;
        if (!this instanceof SAT.HtmlView) {
            throw new TypeError("SAT.HtmlView is a constructor and must be called with new");
        }
        var topContainer = document.createElement("div"),
            controlContainer = document.createElement("div"),
            successCountNode = document.createElement("div"),
            failCountNode = document.createElement("div"),
            filterInput = document.createElement("input"),
            runButton = document.createElement("button"),
            log = document.createElement("div"),
            successCount = 0,
            failCount = 0,
            testIdxToMessageGroup = {};

        function getMessageGroupByTestIdx(testIdx) {
            var messageGroup = testIdxToMessageGroup[testIdx];
            if (!messageGroup) {
                messageGroup = testIdxToMessageGroup[testIdx] = { top: null, title: null, log: null, complete: false, success: false };
            }
            return messageGroup;
        }

        topContainer.style.display = "flex";
        topContainer.style.flexDirection = "column";
        topContainer.style.height = "100%";
        topContainer.appendChild(controlContainer);
        topContainer.appendChild(log);

        controlContainer.style.display = "flex";
        controlContainer.appendChild(successCountNode);
        controlContainer.appendChild(failCountNode);
        controlContainer.appendChild(runButton);
        controlContainer.appendChild(filterInput);
        controlContainer.style.fontFamily = "Sans-Serif";
        controlContainer.style.fontSize = "24pt";
        successCountNode.style.background = "green";
        failCountNode.style.background = "red";
        failCountNode.style.padding = successCountNode.style.padding = "5px";

        log.style.flex = "1";
        log.style.overflow = "scroll";
        log.style.height = "100%";
        log.style.fontFamily = "Consolas, Fixed-Width";
        filterInput.style.flex = "1";
        filterInput.placeholder = "Test Name Filter";

        runButton.innerText = "Run";
        
        root.appendChild(topContainer);

        runButton.addEventListener("click", function () {
            var filterText = filterInput.value,
                filterFn;

            filterFn = function (test) {
                return test.name.toLowerCase().indexOf(filterText.toLowerCase()) !== -1 ||
                    (new RegExp(filterText || ".*")).test(test.name);
            }

            runButton.setAttribute("disabled", "disabled");
            function complete() {
                runButton.removeAttribute("disabled");
            }
            
            tester.runAsync(filterFn).then(complete, complete);
        });

        function updateCounts() {
            successCountNode.innerText = successCount;
            failCountNode.innerText = failCount;
        }
        updateCounts();
        function addLogMessage(text, test) {
            var newline = document.createElement("div");
            newline.innerText = text + (test.complete ? "(Logging after completion error)" : "");
            getMessageGroupByTestIdx(test.idx).log.appendChild(newline);
            if (test.complete) {
                test.complete = false;
                if (test.success) {
                    --successCount;
                }
                else {
                    --failCount;
                }
                testCompletedHandler({ test: test, name: test.name, time: Date.now(), status: SAT.fail, error: new Error("Logging after test completion.") });
            }
        }

        tester.addEventListener("testStarted", function (args) {
            var lastMessageGroup = getMessageGroupByTestIdx(args.test.idx);
            lastMessageGroup.top = document.createElement("div");
            lastMessageGroup.title = document.createElement("div");
            lastMessageGroup.log = document.createElement("div");

            lastMessageGroup.top.appendChild(lastMessageGroup.title);
            lastMessageGroup.title.innerText = args.name;
            lastMessageGroup.top.appendChild(lastMessageGroup.log);
            lastMessageGroup.title.addEventListener("click", function (log) {
                log.style.display = (log.style.display === "none" ? "block" : "none");
            }.bind(this, lastMessageGroup.log));
            log.appendChild(lastMessageGroup.top);
        });
        var testCompletedHandler = function (args) {
            var lastMessageGroup = getMessageGroupByTestIdx(args.test.idx);
            lastMessageGroup.title.innerText = args.test.idx + ". " + args.test.name + ": " + args.status;

            if (args.status === SAT.success) {
                lastMessageGroup.title.style.color = "green";
                ++successCount;
                lastMessageGroup.title.click();
                addLogMessage("Test completed successfully.", args.test);
            }
            else {
                if (args.error) {
                    if (args.error.description) {
                        addLogMessage("Error: " + args.error.description, args.test);
                    }
                    if (args.error.stack) {
                        addLogMessage("Stack: " + args.error.stack, args.test);
                    }
                }
                addLogMessage("Test completed unsuccessfully.", args.test);
                lastMessageGroup.title.style.color = "red";
                ++failCount;
            }
            updateCounts();
            args.test.complete = true;
            args.test.success = (args.status === SAT.success);
        }
        tester.addEventListener("testCompleted", testCompletedHandler);
        tester.addEventListener("messageAdded", function (args) {
            addLogMessage(args.text, args.test);
        });
        tester.addEventListener("messagesCleared", function () {
            log.innerHTML = "";
            successCount = 0;
            failCount = 0;
            updateCounts();
        });
    }

    if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
        module.exports = SAT;
    }
    else {
        root.SAT = SAT;
    }
})(this);
