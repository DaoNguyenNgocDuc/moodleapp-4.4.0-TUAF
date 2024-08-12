// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/* global H5PEmbedCommunicator:true */
/**
 * When embedded the communicator helps talk to the parent page.
 * This is a copy of the H5P.communicator, which we need to communicate in this context
 *
 * @type {H5PEmbedCommunicator}
 * @module     core_h5p
 * @copyright  2019 Joubel AS <contact@joubel.com>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
H5PEmbedCommunicator = (function() {
    /**
     * @class
     * @private
     */
    function Communicator() {
        var self = this;

        // Maps actions to functions.
        var actionHandlers = {};

        // Register message listener.
        window.addEventListener('message', function receiveMessage(event) {
            if (window.parent !== event.source || event.data.context !== 'h5p') {
                return; // Only handle messages from parent and in the correct context.
            }

            if (actionHandlers[event.data.action] !== undefined) {
                actionHandlers[event.data.action](event.data);
            }
        }, false);

        /**
         * Register action listener.
         *
         * @param {string} action What you are waiting for
         * @param {function} handler What you want done
         */
        self.on = function(action, handler) {
            actionHandlers[action] = handler;
        };

        /**
         * Send a message to the all mighty father.
         *
         * @param {string} action
         * @param {Object} [data] payload
         */
        self.send = function(action, data) {
            if (data === undefined) {
                data = {};
            }
            data.context = 'h5p';
            data.action = action;

            // Parent origin can be anything.
            window.parent.postMessage(data, '*');
        };

        /**
         * Send a xAPI statement to LMS.
         *
         * @param {string} component
         * @param {Object} statements
         * @returns {void}
         */
        self.post = function(component, statements) {
            window.parent.postMessage({
                environment: 'moodleapp',
                context: 'h5p',
                action: 'xapi_post_statement',
                component: component,
                statements: statements,
            }, '*');
        };

        /**
         * Send a xAPI state to LMS.
         *
         * @param {string} component
         * @param {string} activityId
         * @param {Object} agent
         * @param {string} stateId
         * @param {string} stateData
         * @returns {void}
         */
        self.postState = function(component, activityId, agent, stateId, stateData) {
            window.parent.postMessage({
                environment: 'moodleapp',
                context: 'h5p',
                action: 'xapi_post_state',
                component: component,
                activityId: activityId,
                agent: agent,
                stateId: stateId,
                stateData: stateData,
            }, '*');
        };

        /**
         * Delete a xAPI state from LMS.
         *
         * @param {string} component
         * @param {string} activityId
         * @param {Object} agent
         * @param {string} stateId
         * @returns {void}
         */
        self.deleteState = function(component, activityId, agent, stateId) {
            window.parent.postMessage({
                environment: 'moodleapp',
                context: 'h5p',
                action: 'xapi_delete_state',
                component: component,
                activityId: activityId,
                agent: agent,
                stateId: stateId,
            }, '*');
        };
    }

    return (window.postMessage && window.addEventListener ? new Communicator() : undefined);
})();

var getH5PObject = async (iFrame) => {
    var H5P = iFrame.contentWindow.H5P;
    if (H5P && H5P.instances && H5P.instances[0]) {
        return H5P;
    }

    // In some cases, the H5P takes a while to be initialized (which causes some random behat failures).
    const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
    let remainingAttemps = 10;
    while ((!H5P || !H5P.instances || !H5P.instances[0]) && remainingAttemps > 0) {
        await sleep(100);
        H5P = iFrame.contentWindow.H5P;
        remainingAttemps--;
    }
    return H5P;
};

document.onreadystatechange = async() => {
    // Wait for instances to be initialize.
    if (document.readyState !== 'complete') {
        return;
    }

    /** @var {boolean} statementPosted Whether the statement has been sent or not, to avoid sending xAPI State after it. */
    var statementPosted = false;

    // Check for H5P iFrame.
    var iFrame = document.querySelector('.h5p-iframe');
    if (!iFrame || !iFrame.contentWindow) {
        return;
    }
    var H5P = await getH5PObject(iFrame);
    if (!H5P || !H5P.instances || !H5P.instances[0]) {
        return;
    }

    var resizeDelay;
    var instance = H5P.instances[0];
    var parentIsFriendly = false;

    // Handle that the resizer is loaded after the iframe.
    H5PEmbedCommunicator.on('ready', function() {
        H5PEmbedCommunicator.send('hello');
    });

    // Handle hello message from our parent window.
    H5PEmbedCommunicator.on('hello', function() {
        // Initial setup/handshake is done.
        parentIsFriendly = true;

        // Hide scrollbars for correct size.
        iFrame.contentDocument.body.style.overflow = 'hidden';

        document.body.classList.add('h5p-resizing');

        // Content need to be resized to fit the new iframe size.
        H5P.trigger(instance, 'resize');
    });

    // When resize has been prepared tell parent window to resize.
    H5PEmbedCommunicator.on('resizePrepared', function() {
        H5PEmbedCommunicator.send('resize', {
            scrollHeight: getIframeBodyHeights(iFrame).scrollHeight
        });
    });

    H5PEmbedCommunicator.on('resize', function() {
        H5P.trigger(instance, 'resize');
    });

    H5P.on(instance, 'resize', function() {
        if (H5P.isFullscreen) {
            return; // Skip iframe resize.
        }

        // Use a delay to make sure iframe is resized to the correct size.
        clearTimeout(resizeDelay);
        resizeDelay = setTimeout(function() {
            // Only resize if the iframe can be resized.
            if (parentIsFriendly) {
                var heights = getIframeBodyHeights(iFrame);
                H5PEmbedCommunicator.send('prepareResize',
                    {
                        scrollHeight: heights.scrollHeight,
                        clientHeight: heights.clientHeight
                    }
                );
            } else {
                H5PEmbedCommunicator.send('hello');
            }
        }, 0);
    });

    // Get emitted xAPI data.
    H5P.externalDispatcher.on('xAPI', function(event) {
        statementPosted = false;
        var moodlecomponent = H5P.getMoodleComponent();
        if (moodlecomponent == undefined) {
            return;
        }
        // Skip malformed events.
        var hasStatement = event && event.data && event.data.statement;
        if (!hasStatement) {
            return;
        }

        var statement = event.data.statement;
        var validVerb = statement.verb && statement.verb.id;
        if (!validVerb) {
            return;
        }

        var isCompleted = statement.verb.id === 'http://adlnet.gov/expapi/verbs/answered'
                    || statement.verb.id === 'http://adlnet.gov/expapi/verbs/completed';

        var isChild = statement.context && statement.context.contextActivities &&
        statement.context.contextActivities.parent &&
        statement.context.contextActivities.parent[0] &&
        statement.context.contextActivities.parent[0].id;

        if (isCompleted && !isChild) {
            var statements = H5P.getXAPIStatements(this.contentId, statement);
            H5PEmbedCommunicator.post(moodlecomponent, statements);
            // Mark the statement has been sent, to avoid sending xAPI State after it.
            statementPosted = true;
        }
    });

    H5P.externalDispatcher.on('xAPIState', function(event) {
        var moodlecomponent = H5P.getMoodleComponent();
        var contentId = event.data.activityId;
        var stateId = event.data.stateId;
        var state = event.data.state;
        if (state === undefined) {
            // When state is undefined, a call to the WS for getting the state could be done. However, for now, this is not
            // required because the content state is initialised with PHP.
            return;
        }

        if (state === null) {
            // When this method is called from the H5P API with null state, the state must be deleted using the rest of attributes.
            H5PEmbedCommunicator.deleteState(moodlecomponent, contentId, H5P.getxAPIActor(), stateId);
        } else if (!statementPosted) {
            // Only update the state if a statement hasn't been posted recently.
            // When state is defined, it needs to be updated. As not all the H5P content types are returning a JSON, we need
            // to simulate it because xAPI State defines statedata as a JSON.
            var statedata = {
                h5p: state
            };
            H5PEmbedCommunicator.postState(moodlecomponent, contentId, H5P.getxAPIActor(), stateId, JSON.stringify(statedata));
        }
    });

    // Trigger initial resize for instance.
    H5P.trigger(instance, 'resize');
};

// Function created for the Moodle app.
// It also takes the current body margin into account because some user agents put some margin to the body of the outer iframe.
function getIframeBodyHeights(iFrame) {
    var margin = parseInt(getComputedStyle(document.body)['margin'], 10) || 0;

    return {
        scrollHeight: iFrame.contentDocument.body.scrollHeight + margin * 2,
        clientHeight: iFrame.contentDocument.body.clientHeight + margin * 2,
    };
}
