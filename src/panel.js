function f() {

	'use strict';

	console.log( 'rStats' );

	function _h ( f, pre, post ) {
		return function () {
			var args = pre.apply( this, arguments ) || arguments;
			var res = f.apply( this, args );
			var r;
			return post ? ( r = post.apply( this, [ res, args ] ), r ? r : res ) : res;
		};
	}

	window.contexts = [];

	HTMLCanvasElement.prototype.getContext = _h( HTMLCanvasElement.prototype.getContext,
		function() {
			console.log( 'CANVAS')
		},
		function( res, args ) {
			if( args[ 0 ] === 'webgl' || args[ 0 ] === 'experimental-webgl' ) {
				var queryExt = res.getExtension("EXT_disjoint_timer_query");
				if( queryExt ) {
					contexts.push( {
						gl: res,
						queryExt: queryExt,
						queries: [],
						frames: {}
					} );
				}
			}
		}
		);

	var drawCalls = 0;

	WebGLRenderingContext.prototype.drawArrays = _h( WebGLRenderingContext.prototype.drawArrays, function () {
		drawCalls ++;
		// drawCalls += arguments[ 2 ];
	} );
	WebGLRenderingContext.prototype.drawElements = _h( WebGLRenderingContext.prototype.drawElements, function () {
		drawCalls ++;
		// drawCalls += arguments[ 1 ];
	} );

	var globalTime = 0;

	for( var j in WebGLRenderingContext.prototype ) {
		try {
			if( typeof WebGLRenderingContext.prototype[ j ] === 'function' ){
				( function( id ) {
					var time;
					WebGLRenderingContext.prototype[ j ] = _h(
						WebGLRenderingContext.prototype[ j ],
						function() {
							time = performance.now();
						},
						function() {
							globalTime += performance.now() - time;
						}
						);
				})( j );

			}
		} catch( e ) {
		//console.log( j );
		}
	}

	var label = document.createElement( 'div' );
	label.className = 'label';
	label.style.position = 'fixed';
	label.style.left = 0
	label.style.bottom = 0;
	label.style.backgroundColor = 'black';
	label.style.padding = '5px'
	label.style.color = 'white';
	label.style.zIndex = 100000000;
	label.style.pointerEvents = 'none';

	function Acc( length ) {

		this.length = length;
		this.values = new Array( length )
		this.ptr = 0;

	}

	Acc.prototype.push = function( v ) {

		this.values[ this.ptr++ % this.length  ] = v;

	}

	Acc.prototype.median = function() {

		var values = this.values;
		values.sort( function(a,b) {return a - b;} );

		var half = Math.floor(values.length/2);

		if(values.length % 2)
			return values[half];
		else
			return (values[half-1] + values[half]) / 2.0;

	}

	Acc.prototype.mean = function() {

		var values = this.values;
		return values.reduce( ( a,b ) => a + b, 0 ) / values.length;

	}

	var query = null;
	var lastTime = performance.now()
	var meanLength = 30
	var extValues = new Acc( meanLength );
	var etValues = new Acc( meanLength );
	var rICValues = new Acc( meanLength );
	var rAFValues = new Acc( meanLength );
	var WebGLValues = new Acc( meanLength );
	var frameValues = new Acc( 1 );
	var res = 1;

	function idle( deadline ) {
		if( deadline.didTimeout ) debugger;
		var et = ( 1000 / 60 ) - deadline.timeRemaining();
		rICValues.push( et );
	}

	var originalRAF = requestAnimationFrame;
	var rAFs = [];
	var oTime = performance.now();
	var frames = 0;
	var lastTime = performance.now();
	var startTime = performance.now();

	var frameId = 0;
	var disjointFrames = {};

	function process() {

		var time = performance.now();

		originalRAF( process );
		requestIdleCallback( idle );

		disjointFrames[ frameId ] = { time: 0, queries: 0 };

		contexts.forEach( function( context, id ) {

			var queryExt = context.queryExt,
			gl = context.gl;

			context.queries.forEach( function( q, i ) {
				var query = q.query;
				var available = queryExt.getQueryObjectEXT( query, queryExt.QUERY_RESULT_AVAILABLE_EXT );
				var disjoint = gl.getParameter( queryExt.GPU_DISJOINT_EXT );
				if( available && !disjoint ) {
					var timeElapsed = queryExt.getQueryObjectEXT( query, queryExt.QUERY_RESULT_EXT );
					context.queries.splice( i, 1 );
					disjointFrames[ q.frameId ].time += timeElapsed;
					disjointFrames[ q.frameId ].queries--;
					if( disjointFrames[ q.frameId ].queries === 0 ) {
						extValues.push( disjointFrames[ q.frameId ].time );
						disjointFrames[ q.frameId ] = null;
					}
				}
			} )

			var query = queryExt.createQueryEXT();
			queryExt.beginQueryEXT( queryExt.TIME_ELAPSED_EXT, query );
			context.queries.push( { frameId: frameId, query: query } );
			disjointFrames[ frameId ].queries++;

		} );

		drawCalls = 0
		globalTime = 0;

		rAFs.forEach( function( c, i ) {
			c();
			rAFs.splice( i, 1 );
		} );

		WebGLValues.push( globalTime );

		contexts.forEach( function( context ) {
			var queryExt = context.queryExt;
			queryExt.endQueryEXT( queryExt.TIME_ELAPSED_EXT );
		} );

		var et = performance.now() - time;
		etValues.push( et );

		frames++;
		if( time > lastTime + 1000 ) {
			frameValues.push( frames );
			frames = 0;
			lastTime = time;
		}

		frameId++;

		rAFValues.push( time - oTime );
		oTime = time;

	}

	originalRAF( process );

	function updateValues() {

		var raf = rAFValues.median();
		var timeElapsed = extValues.median() / ( 1000 * 1000 );
		var et = etValues.median();
		var rICet = rICValues.median();
		var comp = timeElapsed + et;
		var wt = WebGLValues.median();
		var fps = frameValues.median();

		var str = 'FPS: ' + fps.toFixed( 2 ) + '<br/>rAF: ' + raf.toFixed( 2 ) + 'ms ' + ( 1000 / raf ).toFixed( 2 ) + 'FPS<br/>EXT_disjoint_timer_query (GPU): ' + timeElapsed.toFixed( res ) + 'ms ' + ( 1000 / timeElapsed ).toFixed( res ) + 'FPS<br/>frame (CPU): ' + et.toFixed( res ) + 'ms ' + ( 1000 / et ).toFixed( res ) + 'FPS<br/>rIC (CPU): ' + rICet.toFixed( res ) + 'ms ' + ( 1000 / rICet ).toFixed( res ) + 'FPS<br/>Comp (CPU+GPU): ' + comp.toFixed(2 ) + 'ms ' + ( 1000 / comp ).toFixed( 2 ) + 'FPS<br/>WebGL CPU Ex: ' + wt.toFixed( 2 ) + 'ms ' + ( 1000 / wt ).toFixed( 2 ) + 'FPS<br/>drawCalls: ' + drawCalls;

		label.innerHTML = str;
		window.postMessage( { method: 'update', value: str }, '*' )

	}

	setInterval( updateValues, 100 );

	requestAnimationFrame = function( c ) {

		rAFs.push( c );

	}

	window.start = function() {
		document.body.appendChild( label );
	}

	window.addEventListener( 'load', start );

}

/*

PANEL STARTS HERE

*/

'use strict'

console.log( 'rStats loaded' );

var button = document.getElementById( 'button' );
button.addEventListener( 'click', function( e ) {
	chrome.devtools.inspectedWindow.reload( {
		ignoreCache: true,
		//injectedScript: '(' + f.toString() + ')()'
	} );
} );

var content = document.getElementById( 'content' );

var backgroundPageConnection = chrome.runtime.connect({
	name: 'panel'
});

backgroundPageConnection.postMessage({
	name: 'init',
	tabId: chrome.devtools.inspectedWindow.tabId
});

backgroundPageConnection.onMessage.addListener( function( msg ) {

	console.log( '>>', msg );

	switch( msg.method ) {
		case 'inject':
		console.log( 'inject' )
		console.log( chrome.devtools.inspectedWindow.eval( '(' + f.toString() + ')({})' ) );
		chrome.devtools.inspectedWindow.eval( 'start()' );
		break;
		case 'loaded':
		console.log( 'loaded' )
		chrome.devtools.inspectedWindow.eval( 'start()' );
		break;
		case 'update':
		content.innerHTML = msg.value;
		break;
	}
} );