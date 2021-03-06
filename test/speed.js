/**
 * @fileoverview The demo for ClusterManger. It will show markers using no clustering, MarkerClusterer, MarkerClustererPlus, and ClusterManager
 * and show the time used.
 * @author Marcus Ulrich (loosely based on: http://google-maps-utility-library-v3.googlecode.com/svn/trunk/markerclusterer/examples/speed_test.js)
 */

function $(element) {
    return document.getElementById(element) || null;
}

speedTest = {};

speedTest.profileStart = function () {
    speedTest.start = performance.now();
    speedTest.millisecondsUsed = 0;
    if (window.console && $('firebugprofile').checked) {
        console.profile();
    }
};

speedTest.profileEnd = function () {
    if (window.console && $('firebugprofile').checked) {
        console.profileEnd();
    }
    var end = performance.now();
    speedTest.millisecondsUsed = end - speedTest.start;
    speedTest.showTime(end - speedTest.start);
};

speedTest.showTime = function(time) {
    if(!time) {
        $('timetaken').innerHTML = ' ... ';
    } else if (time < 0) {
        $('timetaken').innerHTML = 'timing ... ';
    } else {
        $('timetaken').innerHTML = Math.round(time*100)/100;
    }
};

//In MarkerClusterer, the clustering starts when onAdd is called, so we have to add the speed test code here or we're just testing how quickly
//we can create a new MarkerCluster. Enable the profiler to see specifics.

//var onAddOld = MarkerClusterer.prototype.onAdd;
MarkerClusterer.prototype.onAddOld = MarkerClusterer.prototype.onAdd;

MarkerClusterer.prototype.onAdd = function () {
    this.onAddOld.apply(this, arguments);
    speedTest.profileEnd();
};

MarkerClusterer.prototype.addToClosestClusterOld_ = MarkerClusterer.prototype.addToClosestCluster_;

MarkerClusterer.prototype.addToClosestCluster_ = function () {
    var fnTimer = null;
    if(speedTest.millisecondsUsed !== 0) {
        fnTimer = performance.now();
    }    
    this.addToClosestClusterOld_.apply(this, arguments);

    if(speedTest.time !== 0 && fnTimer) {
        var end = performance.now();
        speedTest.millisecondsUsed += end - fnTimer;
        speedTest.showTime(speedTest.millisecondsUsed);
    }
};


speedTest.pics = null;
speedTest.map = null;
speedTest.markerClusterer = null;
speedTest.clusterMgr = null;
speedTest.infoWindow = null;
speedTest.markers = [];

speedTest.init = function () {
    var latlng = new google.maps.LatLng(43.32, -1.98);
    var options = {
        'zoom': 8,
        'center': latlng,
        'mapTypeId': google.maps.MapTypeId.ROADMAP
    };

    speedTest.map = new google.maps.Map($('map'), options);
    speedTest.pics = data.photos;
    speedTest.infoWindow = new google.maps.InfoWindow();

    document.getElementById('addmarkers').onclick = speedTest.change;
    document.getElementById('clearmarkers').onclick = speedTest.clear;

};

speedTest.showMarkers = function () {
    speedTest.markers = [];

    var panel = $('markerlist');
    panel.innerHTML = '';
    var numMarkers = $('nummarkers').value;
    var randomMarkers = $('randommarkers').checked;
    var lazyMarkers = $('lazymarkers').checked;


    if (numMarkers > 1093 && !randomMarkers) {
        alert('Sorry, only 1093 nonrandom markers. Check the "Random" box to input unlimited markers.');
        return;
    }

    var bounds = speedTest.map.getBounds();
    var southWest = bounds.getSouthWest();
    var latSpan = bounds.toSpan().lat();
    var lngSpan = bounds.toSpan().lng();
    var swLatitude = southWest.lat();
    var swLongitude = southWest.lng();

    for (var i = 0, marker; i < numMarkers; i++) {
        if (randomMarkers) {            
            var latLng = speedTest.getRandomLatLng(swLatitude, swLongitude, latSpan, lngSpan);
            if (lazyMarkers && $('clustertype').value === 'clustermanager') {
                marker = {
                    map: speedTest.map,
                    icon: speedTest.makeMarkerImage(),
                    latitude: latLng[0], 
                    longitude: latLng[1], 
                    content: 'Marker ' + i,
                    title: 'Marker ' + i
                };                
            } else {
                marker = speedTest.makeMarker(latLng[0], latLng[1], {
                    latitude: latLng[0], 
                    longitude: latLng[1], 
                    title: 'Marker ' + i
                });
            }
        } else {
       //     if (lazyMarkers) {
        //        var pic = speedTest.pics[i];
        //        marker = speedTest.makeMarkerData(pic.latitude, pic.longitude, pic);                
        //    } else {
                var pic = speedTest.pics[i];
                marker = speedTest.makeMarker(pic.latitude, pic.longitude, pic);
        //    }
        }
        speedTest.markers.push(marker);
    }
    window.setTimeout(speedTest.time, 0);
};


speedTest.getRandomLatLng = function(swLatitude, swLongitude, latSpan, lngSpan) {
    var random1 = Math.random();
    var random2 = Math.random();
    return [((swLatitude + (random1*latSpan)) ) % 90 , 
            (180 + swLongitude + (random2*lngSpan)) % 360 - 180];
    return [((swLatitude - latSpan + (3*random1*latSpan)) ) % 90 , 
            (180 + swLongitude - lngSpan + (3*random2*lngSpan)) % 360 - 180];
};

speedTest.makeMarkerImage = function (opts) {
    var imageUrl = 'http://chart.apis.google.com/chart?cht=mm&chs=24x32&chco=' +
        'FFFFFF,008CFF,000000&ext=.png';
    return new google.maps.MarkerImage(imageUrl,
        new google.maps.Size(24, 32));
};

speedTest.makeMarker = function (lat, lng, opts) {
    var titleText = opts.photo_title || opts.title || 'No title';

    var item = document.createElement('DIV');
    var title = document.createElement('A');
    title.href = '#';
    title.className = 'title';
    title.innerHTML = titleText;

    item.appendChild(title);
    $('markerlist').appendChild(item);

    var latLng = new google.maps.LatLng(lat, lng);

    var marker = new google.maps.Marker({
        position: latLng,
        icon: speedTest.makeMarkerImage(),
        title: opts.photo_title || opts.title
    });

    var fn = speedTest.markerClickFunction(opts, latLng);
    google.maps.event.addListener(marker, 'click', fn);
    google.maps.event.addDomListener(title, 'click', fn);
    return marker;
};

speedTest.markerClickFunction = function (opts, latlng) {
    return function (e) {
        e.cancelBubble = true;
        e.returnValue = false;
        if (e.stopPropagation) {
            e.stopPropagation();
            e.preventDefault();
        }
        var title = opts.photo_title || opts.title || 'No title';

        if (opts.photo_url) {
            var url = opts.photo_url || '';
            var fileurl = opts.photo_file_url || '';
            var ownerurl = opts.owner_url || '';
            var ownername = opts.owner_name || '';

            var infoHtml = '<div class="info"><h3>' + title +
                '</h3><div class="info-body">' +
                '<a href="' + url + '" target="_blank"><img src="' +
                fileurl + '" class="info-img"/></a></div>' +
                '<a href="http://www.panoramio.com/" target="_blank">' +
                '<img src="http://maps.google.com/intl/en_ALL/mapfiles/' +
                'iw_panoramio.png"/></a><br/>' +
                '<a href="' + ownerurl + '" target="_blank">' + ownername +
                '</a></div></div>';
        } else {
            var infoHtml = '<div class="info"><h3>' + title + '</h3></div>';
        }

        speedTest.infoWindow.setContent(infoHtml);
        speedTest.infoWindow.setPosition(latlng);
        var now = new Date();
        speedTest.infoWindow.setZIndex(now.getTime());
        speedTest.infoWindow.open(speedTest.map);
    };
};

speedTest.clear = function () {
    speedTest.showTime(null);

    for (var i = 0, marker; marker = speedTest.markers[i]; i++) {
        if (typeof marker.setMap === "function") {
            marker.setMap(null);
        }
    }
    if (speedTest.markerClusterer) {
        speedTest.markerClusterer.clearMarkers();
    } else if (speedTest.clusterMgr) {
        speedTest.clusterMgr.reset();
    }
    speedTest.markers = [];
};

speedTest.change = function () {
    speedTest.clear();
    speedTest.showMarkers();
};

speedTest.time = function () {
    speedTest.showTime(-1);

    var clusterType = $('clustertype').value;
    delete(speedTest.markerClusterer);
    delete(speedTest.clusterMgr);
    
    speedTest.profileStart();
    
    if (clusterType === 'markerclusterer' || clusterType === 'markerclustererplus') {
        speedTest.markerClusterer = new MarkerClusterer(speedTest.map, speedTest.markers);
        return;
    }
    
    speedTest.profileStart();
    if (clusterType === 'clustermanager') {

        speedTest.clusterMgr = new ClusterManager(speedTest.map, {
            markers: speedTest.markers,
            precision: 2,
            icon_color: "FFFF33"
        });
        speedTest.clusterMgr.show();
    } else {
        for (var i = 0, marker; marker = speedTest.markers[i]; i++) {
            marker.setMap(speedTest.map);
        }
    }
    speedTest.profileEnd();
};

