
//test queue need to be generated
var KEY = //"oshri-dev/color-sdk/566f0ea718ba8e333dd8ad69";
var SECRET = //"NGI5ZjMxc3Nod29lY2RpL2M3M2JhZjdlLTRmMWItNDVjNS05YmFiLTQyZDQzYTAxOTkxNS8zNzY4NDcyMDI5OTAvdXMtd2VzdC0y";


var color = require( "./index" );
var sdk = new color.SDK( KEY, SECRET )
var N = +process.argv[ 2 ];

function start() {

    var data = generate( N );
    for ( var i = 0 ; i < data.length ; i += 1 ) {
        sdk.write( "sdktest", data[ i ] )
    }

    sdk.flush();
}


function generate( n ) {
    var data = [];
    for ( var i = 0 ; i < n ; i += 1 ) {
        data.push({
            user: Math.floor( Math.random() * 10000 ),
            device: "iPhone",
            name: "Name",
            age: Math.floor( Math.random() * 100 )
        })
    }
    return data;
}

module.start = start;
module.sdk = sdk;
module.generate = generate;

if ( require.main === module ) {
    start();
}


