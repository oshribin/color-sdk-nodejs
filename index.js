var url = require( "url" );
var util = require( "util" );
var http = require( "http" );
var https = require( "https" );
var events = require( "events" );
var qs = require( "querystring" );
var pkg = require( "./package.json" );

var MAXSIZE = 1024 * 250; // 250kib
var FLUSH_TIMEOUT = 2 * 1000; // 2 seconds

module.exports.SDK = SDK;

util.inherits( SDK, events.EventEmitter );
function SDK ( apikey, apisecret ) {
    events.EventEmitter.call( this );

    // api-key: ACCOUNT/color-sdk/RAND1
    // api-secret: BASE64( RAND2/queueid/AWSACCOUNT/REGION )
    var accounts = apikey.split( "/" );
    var qaccount = accounts[ 1 ];
    var decoded = new Buffer( apisecret, "base64" ).toString().split( "/" );
    var qid = decoded[ 1 ];
    var awsaccount = decoded[ 2 ];
    var region = decoded[ 3 ];

    this.apikey = apikey;
    this.apisecret = apisecret;
    this.logger = console.log;
    this._buffer = "";
    this._timeout = null;

    this.qurl = [
        "https://sqs." + region + ".amazonaws.com",
        awsaccount,
        qaccount + "-" + qid
    ].join( "/" );

    this.flushcnt = 0;
    this.flushid = 0;
    this.eventscnt = 0;

    this._log( "Created. Version: " + pkg.version );
    this._log( "Queue URL: ", this.qurl );

    this.on( "error", function ( err ) {
        this._log( "ERROR #" + err.id + ":", err );
    })

    this.on( "warn", function ( err ) {
        this._log( "WARN #" + err.id + ":", err );
    })

    this.on( "send", function ( data ) {
        this._log( "Sending #" + data.id + ":", "tries: " + data.tries + " ,", 
            data.count, "events", 
            "(" + data.size + " bytes)",
            this.flushcnt, "flushes remaining"
        );
    })

    this.on( "flush", function ( data ) {
        this._log( "Sent Successfuly #" + data.id + ":", 
            data.count, "events", 
            "(" + data.size + " bytes)",
            "in", data.t + "s",
            this.flushcnt, "flushes remaining"
        );
    })

    this.on( "empty", function () {
        this.flushcnt = 0;
        this._log( "Empty" );
    })
}

SDK.prototype.write = function ( table, data ) {
    data = copy( data );
    data.__table = table;
    this._buffer += encodeURIComponent( JSON.stringify( data ) + "\n" );
    this.eventscnt += 1;

    if ( this._buffer.length > MAXSIZE ) {
        this.flush(); // max size is exceeded, flush immediately
    } else if ( !this._timeout ) {
        // flush something after the flush timeout 
        this._timeout = setTimeout( this.flush.bind( this ), FLUSH_TIMEOUT );
    }

    return this;
}

SDK.prototype._log = function () {
    if ( !this.logger ) {
        return;
    }

    var args = [].slice.call( arguments );
    args = [ new Date().toISOString(), "COLOR-SDK" ].concat( args );
    this.logger.apply( null, args );
}

SDK.prototype.flush = function () {
    clearTimeout( this._timeout );
    this._timeout = null;
    if ( !this._buffer.length ) {
        if ( !this.flushcnt ) {
            this.emit( "empty" )
        }
        return
    }

    var that = this;
    var done = false;
    var retries = 3;
    var count = this.eventscnt;
    var buffer = this._buffer;
    var flushid = ++this.flushid;
    var size = buffer.length;

    this.eventscnt = 0;
    this.flushcnt += 1;
    this._buffer = "";

    var time = new Date().toISOString();
    var body = [
        "Action=SendMessage",
        "MessageBody=" + buffer,
        "MessageAttribute.1.Name=key",
        "MessageAttribute.1.Value.DataType=String",
        "MessageAttribute.1.Value.StringValue=" + this.apikey,
        "MessageAttribute.2.Name=secret",
        "MessageAttribute.2.Value.DataType=String",
        "MessageAttribute.2.Value.StringValue=" + this.apisecret,
        "MessageAttribute.3.Name=sdk",
        "MessageAttribute.3.Value.DataType=String",
        "MessageAttribute.3.Value.StringValue=" + pkg.name + "-" + pkg.version,
    ].join( "&" );

    var parsedurl = url.parse( this.qurl )
    var options = {
        port: 443,
        method: "POST",
        path: parsedurl.path,
        hostname: parsedurl.hostname,
        headers: {
            "Content-Length": body.length,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    }

    var t;
    var tries = 0;
    request();

    function request() {
        t = new Date().getTime();
        that.emit( "send", { 
            id: flushid, 
            count: count, 
            size: size, 
            fullsize: body.length,
            tries: ++tries 
        });
        var req = https.request( options, function ( res ) {
            var code = res.statusCode;
            var body = "";
            res
                .on( "error", onerror )
                .on( "data", function ( d ) { body += d.toString(); } )
                .on( "end", function () {
                    if ( code < 200 || code > 300 ) {
                        var err = [
                            code, ":", http.STATUS_CODES[ code ], body
                        ].join( " " );
                        onerror( new Error( err ) );
                    } else {
                        onend();
                    }
                })
                
        })
        .on( "error", onerror )
        req.setTimeout( 60 * 1000 );
        req.end( body );
    }

    function onerror ( err ) {
        err.id = flushid;
        that.emit( "warn", err );
        if ( done ) return;
        if ( retries-- > 0 ) {
            that._log( "Retrying after error, in 2s. Remaining: ", retries );
            return setTimeout( request, 2000 );
        }

        that.emit( "error", err );
        if ( --that.flushcnt <= 0 && !that._buffer ) { 
            that.emit( "empty" ) 
        }
        done = true;
    }

    function onend() {
        t = ( new Date().getTime() - t ) / 1000;
        that.emit( "flush", { 
            id: flushid, 
            count: count, 
            size: size, 
            fullsize: body.length,
            t: t 
        });
        if ( done ) return;
        if ( --that.flushcnt <= 0 && !that._buffer ) { 
            that.emit( "empty" ) 
        }
        done = true;
    }

    return this;
}

function copy ( obj ) {
    return JSON.parse( JSON.stringify( obj ) );
}
