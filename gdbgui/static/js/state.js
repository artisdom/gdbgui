// State management and reactive components with plain JavaScript

 /* global maquette */
const stator = (function(){
"use strict;"

/**
 * `state` is a global object that stores key/value pairs, and has subscribers that listen for updates.
 * It needs to be initialized with an object, and from that point forward, the object cannot be mutated in place.
 * Values can only be updated via the `state.set()` function. When keys of the object are updated, they are replaced (not mutated).
 * Additionally, they must be replaced with values of the same type (or null/undefined) otherwise an error will be thrown.
 */
const state = {
    /**
     * Set the initial state. This can only be done once, and must be done before the
     * state can be modified. This should be a JavaScript object with key/value pairs.
     * This is the initial "hydration" of the state, and sets the expected types for all keys.
     * @param {object} initial_state: Initial state object
     */
    initialize: function(initial_state){
        if(state._state_created){
            throw 'cannot create more than one global state'
        }
        for(let k in initial_state){
            state._state[k] = _clone_obj(initial_state[k])
        }
        state._state_created = true
    },
    /**
     * options object with the following fields. Can be set like `state.options.debounce_ms = 30`
     * * **debounce_ms (int, default: 10)**  update subscribers only after this much time has passed and an update has not occurred
     * * **max_batched_event_count (int, default: 10)** emit event only after this much time has passed and subscribers have not been notified <= 0 will notify immediately. max delay is: debounce_ms * max_batched_event_count
     * * **debug (bool, default: false)**: if true, print state changes to console
     */
    options: {
        debounce_ms: 0,
        max_batched_event_count: 0,
        debug: false,
    },
    /**
     * set key or keys of state object
     * @param {str/obj} key_or_new_state: if str, this key is replaced. If obj, all keys of the obj replace state's keys.
     * @param {any} value: If key was provided, the associated value. The type of the value for this key cannot change. Exceptions to this rule
     * are to/from null or undefined. Otherwise if you try to change, say, `1` to `'2'`, a type error will occur (int to string is not permitted).
     *
     * **Examples:**
     *
     * `state.set('myvar', 6)  // replace only 'myvar'`
     *
     * `state.set('myvar2', [1, 2, 3])  // replace only 'myvar2'`
     *
     * `state.set({'myvar': 6, 'myvar2': [1, 2, 3]) // replace state with all the keys of the object`
     */
    set: function(key_or_new_state, value){
        if(arguments.length === 1){
            // replace the whole state
            let new_state = key_or_new_state
            for(let k in new_state){
                state.set(k, new_state[k])
            }
            return
        }

        let key = key_or_new_state
        let t = state._state  // t is the target object to update
        if(!(t.hasOwnProperty(key))){
            // use hasOwnProperty for better performance (entrie prototype chain is not traversed)
            throw `cannot create new key after initialization (attempted to create ${key})`
        }

        let oldval = t[key]

        // update the state
        if(_value_changed(oldval, value)){

            if(state.options.debug) {
                console.log('stator ' + key, oldval, ' -> ', value)
            }

            _check_type_match(oldval, value, key)

            // *replace* the property with a clone of the value
            t[key] = _clone_obj(value)

            // suppress active timeouts (if any)
            if(state._debounce_timeout){
                state._clear_debounce_timeout()
                state._batched_event_count++
            }

            // emit event, or schedule event to be emitted so that Reactors and listeners are notified
            // that the state changed
            if(state._batched_event_count >= state.options.max_batched_event_count){
                // emit event immediately since we have suppressed enough already
                if(state.options.debug){
                    console.log(`suppressed ${state._batched_event_count} events (${state.options.max_batched_event_count} max). Emitting event now.`)
                }
                state.publish()
            }else{
                // delay event emission and set new timeout id
                state._debounce_timeout = setTimeout(state.publish, state.options.debounce_ms)
            }
        }
    },
    /**
     * Get copy of value (not reference) of one of the keys in the current state.
     * @param {str} key key of the state object to get a copy of
     * @return copy of value of the current state's key
     *
     * **Examples:**
     *
     *
     * ```js
     * let local_var = state.get('myvar')  // returns copy of value of myvar
     * let local_arr = state.get('myarray')  // returns copy of value of myarray
     * local_arr[0] = 'hello'  // local_arr changed, but state did not
     * state.set('myarray', local_arr)  // state changed
     * local_arr[0] = 'bye'  // local_arr changed, but state did not
     * ```
     *
     * ```js
     * let s = state.get() // get the whole state
     * s.myarray[0] = 'hello'  // state was not updated, but local variable `s` was
     * state.set(s)  // `state` is now updated
     * ```
     */
    get: function(key){
        if(arguments.length === 0){
            // return the whole state
            return _clone_obj(state._state)
        }
        // the "get" trap returns a value
        if(state._state.hasOwnProperty(key)){
            // return copy since state cannot be mutated in place
            return _clone_obj(state._state[key])
        }else{
            throw `attempted to access key that was not set during initialization: ${key}`
        }
    },
    /**
     * Add listener(s) to state changes. Reactors are automatically subscribed to state changes.
     * @param {function} function or array of functions to be called when event is dispatched due to State updates
     */
    subscribe(callback_function){
        if(Array.isArray(callback_function)){
            state._callbacks = state._callbacks.concat(callback_function)
        }else{
            state._callbacks.push(callback_function)
        }
    },
    /**
     * Remove listener of state changes
     * @param {function} function to stop being called when state is udpated
     */
    unsubscribe(callback_function){
        state._callbacks = state._callbacks.filter(c => c !== callback_function)
    },
    /**
     * Run subscribers' callback functions. Reactors are automatically part of this list.
     */
    publish: function(){
        state._projector.scheduleRender()

        state._clear_debounce_timeout()
        state._batched_state_changes = 0

        state._callbacks.map(c => c())
    },
    /**
     * array of functions to be called when state changes (usually Reactor.render())
     */
    _callbacks: [],
    /**
     * Actual state is held here, but should NEVER be accessed directly. Only access through state.set/state.get!
     */
    _state: {},
    /**
     * dom selections that are bound to a reactor (i.e. `#my_id`)
     */
    _elements: [],
    /**
     * Clear the debounce timeout
     */
    _clear_debounce_timeout: function(){
        clearTimeout(state._debounce_timeout)
        state._debounce_timeout = null
    },
    /**
     * Debounce timeout
     */
    _debounce_timeout: null,
    /**
     * Suppressed event count.
     * Incremented when a queued timeout is replaced with new timeout. If queued timeouts keep getting
     * replaced, events never get dispatched. This is an "escape hatch" for that.
     * Set to zero when event is dispatched.
     */
    _batched_state_changes: 0,
    _state_created: false,
    _projector: maquette.createProjector()
}

/**
 * Reactive component that links a html-returning function to a DOM node. _Any changes to `state` will cause all `Reactor`s to
 * call their respective render functions and potentially update the html of their DOM node.
 * @param {string} element selector to have its inner html updated (i.e. `#my_id`). Selector must match exactly one node or an error will be raised.
 * @param {function} render_callback function that returns html that relplaces the inner html of element. This function is run when the state is updated.
 * @param {object} options Option list:
 *
 * * **listen_to_global_state (bool, default: true)**: Call render function for this Reactor when global state changes
 * * **render_on_init  (bool, default: true)**: Immediately call render function on initialization
 * * **force_update  (bool, default: false)**: Force the inner html of the reactor's DOM node to be updated, even if it did not change. The Reactor resets this to back to false after force-updating innerHTML.
 *
 * The following options all correspond to functions that are called when a Reactor is rendering. All of these functions will receive the Reactor
 * object as the first and only argument when they are called. See Reactor.render() for more information.
 * * **before_render (function, no default)**: function that is called on entry to render function (always called when `render()` is called)
 * * **should_render (function, default: ()=>true)**: function that returns a boolean and conditionally sets html
 * * **before_dom_update (function, no default)**: function called before html is updated (only called if `should_render()` returned true and html changed)
 * * **after_html_domte (function, no default)**: function called after html is updated (only called if `should_render()` returned true and html changed)
 * * **after_render (function, no default)**: called on exit from render function (always called when `render()` is called)
 */
function Reactor(element, render_callback, options={}){
    // select from dom once and cache it
    let nodes = document.querySelectorAll(element)
    if(nodes.length !== 1){
        throw `Reactor: querySelector "${element}" matched ${nodes.length} nodes. Expected 1.`
    }else if (state._elements.indexOf(element) !== -1) {
        throw `Reactor: querySelector "${element}" is already bound to a Reactor.`
    }else{
        state._elements.push(element)
    }
    this.element = element
    this.node = nodes[0]

    let default_options = {
        maquette: false,
        listen_to_global_state: true,
        render_on_init: true,
        before_render: (reactor)=>{},
        should_render: (reactor)=>{return true},
        before_dom_update: (reactor)=>{},
        after_dom_update: (reactor)=>{},
        after_render: (reactor)=>{},
    }
    let invalid_options = Object.keys(options)
                            .filter(o => Object.keys(default_options).indexOf(o) === -1)


    if(invalid_options.length > 0){
        invalid_options.map(o => console.error(`Reactor got invalid option "${o}"`))
        return
    }
    // save options
    this.options = Object.assign(default_options, options)

    if(this.options.maquette){
        // let maquette replace the contents of the node with the render callback
        // TODO only pass maquette render callbacks
        state._projector.replace(this.node, render_callback)
        return
    }

    // store the render callback
    if(!render_callback || typeof render_callback !== 'function'){
        throw `Reactor did not receive a render callback function. This argument should be a function that returns html to populate the DOM element.`
    }
    this._render = render_callback.bind(this)  // this._render is called in this.render

    if(this.options.listen_to_global_state){
        // call render function when global state changes
        state.subscribe(this.render.bind(this))
    }
    if(this.options.render_on_init){
        this.render() // call the update function immediately so it renders itself
    }
}

/**
 * Calls the `render()` callback of the Reactor instance, and updates the inner html
 * of the Reactors's node if the new html does not match the previously rendered html.
 * i.e. `myreactor.render()`
 *
 * The render function looks like this has various lifecycle functions, all of them optional. The source code is displayed below for clarity.
 */
Reactor.prototype.render = function(){
    this.options.before_render(this)
    if(this.options.should_render(this)){
        // compute new value of node (it may or may not have changed)
        let html_or_element = this._render(this)

        if(Array.isArray(html_or_element)){
            html_or_element = html_or_element
        }

        let is_string = typeof html_or_element === 'string'
        , is_element = html_or_element instanceof window.Element
        , do_update = this.options.force_update

        if(is_string && html_or_element !== this.old_html_or_element){
            do_update = true
        }else if(is_element && !html_or_element.isEqualNode(this.node)){
            do_update = true
        }else if (Array.isArray(html_or_element)){
            do_update = true
        }


        // update dom only if the return value of render changed
        if(do_update){
            this.options.force_update = false
            this.options.before_dom_update(this)
            this.node.innerHTML = html_or_element
            this.options.after_dom_update(this)
            this.old_html_or_element = html_or_element
        }
    }
    this.options.after_render(this)
}

/****** helper functions ********/

function _clone_obj(obj){
    if(obj === undefined){return undefined}
    return JSON.parse(JSON.stringify(obj))
}

function _check_type_match(a, b, key){
    if(a !== undefined && b !== undefined && a !== null && b !== null){
        let old_type = typeof a
        , new_type = typeof b
        if(old_type !== new_type){
            console.error('attempted to change ', key, ' from ', a, ' (', old_type, ') to ', b, ' (', new_type, ')')
            throw 'type error'
        }
    }
}

function _value_changed(a, b){
    if(Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0){
        return false
    }else{
        return a !== b
    }
}

return {'state': state, 'Reactor': Reactor}
})()

// global variables in browser
const state = stator.state
const Reactor = stator.Reactor
const h = maquette.h // from vendor
