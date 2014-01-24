/**
 * @fileoverview The demo for ClusterManger. It will show 100 markers using MarkerClusterer and count the time to show the difference between using
 * no clustering, MarkerClusterer, MarkerClustererPlus, and ClusterManager.
 * @author Marcus Ulrich (loosely based on: http://google-maps-utility-library-v3.googlecode.com/svn/trunk/markerclusterer/examples/speed_test.js)
 */

function $(element) {
  return document.getElementById(element) || null;
}

//In MarkerClusterer, the clustering starts when onAdd is called, so we have to add the speed test code here or we're just testing how quickly
//we can create a new MarkerCluster. Enable the profiler to see specifics.
MarkerClusterer.prototype.onAddOld = MarkerClusterer.prototype.onAdd;

MarkerClusterer.prototype.onAdd = function () {
    if (window.console && $('firebugprofile').checked) { 
        console.profile(); 
    }
    var start = new Date();
    this.onAddOld();
    var end = new Date();
    $('timetaken').innerHTML = end - start;
    if (window.console && $('firebugprofile').checked) { 
    console.profileEnd(); 
    }
};

speedTest = {};

speedTest.pics = null;
speedTest.map = null;
speedTest.markerClusterer = null;
speedTest.clusterMgr = null;
speedTest.infoWindow = null;
speedTest.markers = [];

speedTest.init = function() {
  var latlng = new google.maps.LatLng(39.91, 116.38);
  var options = {
    'zoom': 2,
    'center': latlng,
    'mapTypeId': google.maps.MapTypeId.ROADMAP
  };

  speedTest.map = new google.maps.Map($('map'), options);
  speedTest.pics = data.photos;
  speedTest.infoWindow = new google.maps.InfoWindow();

  document.getElementById('addmarkers').onclick = speedTest.change;
  document.getElementById('clearmarkers').onclick = speedTest.clear;

};

speedTest.extra = function() {
  var clusterer = new ClusterManager(speedTest.map, {
      precision  : 2,
      icon_color : "FFFF33"
      });
  for(var i=0, count=1, geohash, bounds, distance, area; count<50; count++) {
    geohash = clusterer.getGeohash(39.91, 116.38, count);
    geohash1 = clusterer.getGeohash(9.91, 16.38, count);
    bounds = clusterer.geohashGetLatLngBounds(geohash);
    bounds1 = clusterer.geohashGetLatLngBounds(geohash1);
    distance1 = google.maps.geometry.spherical.computeDistanceBetween(new google.maps.LatLng(0, 0), new google.maps.LatLng(bounds.toSpan().lat(), 0));
    distance2 = google.maps.geometry.spherical.computeDistanceBetween(new google.maps.LatLng(45, 45), new google.maps.LatLng(45, bounds.toSpan().lng()+45));

    console.info(" * " + count + "	" + bounds.toSpan().lat() + "	" + distance1 + "m");
//    console.log("Example geohash: " + geohash); 
  }

}

speedTest.showMarkers = function() {
  speedTest.markers = [];

  var panel = $('markerlist');
  panel.innerHTML = '';
  var numMarkers = $('nummarkers').value;
  var randomMarkers = $('randommarkers').checked;

  for (var i=0, marker; i<numMarkers; i++) {
    if(randomMarkers) {
      var latLng = speedTest.getRandomLatLng();
      marker = speedTest.makeMarker(latLng[0], latLng[1], {title:'Marker ' + i});
    } else {
      var pic = speedTest.pics[i];
      marker = speedTest.makeMarker(pic.latitude, pic.longitude, pic);
    }
    speedTest.markers.push(marker);
  }

  window.setTimeout(speedTest.time, 0);
};

speedTest.getRandomLatLng = function() {
  var bounds = speedTest.map.getBounds();
  var southWest = bounds.getSouthWest();
  var latSpan = bounds.toSpan().lat();
  var lngSpan = bounds.toSpan().lng();
  var lat = (southWest.lat() + latSpan * Math.random())%90;
  var lng = (southWest.lng() + lngSpan * Math.random())%180;
  return [lat, lng];
};

speedTest.makeMarker = function(lat, lng, opts) {
    var titleText = opts.photo_title || opts.title || 'No title';

    var item = document.createElement('DIV');
    var title = document.createElement('A');
    title.href = '#';
    title.className = 'title';
    title.innerHTML = titleText;

    item.appendChild(title);
    $('markerlist').appendChild(item);

    var latLng = new google.maps.LatLng(lat, lng);

    var imageUrl = 'http://chart.apis.google.com/chart?cht=mm&chs=24x32&chco=' +
        'FFFFFF,008CFF,000000&ext=.png';
    var markerImage = new google.maps.MarkerImage(imageUrl,
        new google.maps.Size(24, 32));

    var marker = new google.maps.Marker({
      'position' : latLng,
      'icon'     : markerImage,
      'title'    : opts.photo_title || opts.title
    });

    var fn = speedTest.markerClickFunction(opts, latLng);
    google.maps.event.addListener(marker, 'click', fn);
    google.maps.event.addDomListener(title, 'click', fn);
    return marker;
};

speedTest.markerClickFunction = function(opts, latlng) {
  return function(e) {
    e.cancelBubble = true;
    e.returnValue = false;
    if (e.stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
    var title = opts.photo_title || opts.title || 'No title';

    if(opts.photo_url) {
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

speedTest.clear = function() {
  $('timetaken').innerHTML = ' ... ';
  for (var i = 0, marker; marker = speedTest.markers[i]; i++) {
    marker.setMap(null);
  }
  if(speedTest.markerClusterer) {
    speedTest.markerClusterer.clearMarkers();
  }
  if(speedTest.clusterMgr) {
    speedTest.clusterMgr.reset();
  }
  speedTest.markers = [];
};

speedTest.change = function() {
  speedTest.clear();
  speedTest.showMarkers();
};


speedTest.time = function() {
  $('timetaken').innerHTML = 'timing...';
  var clusterType = $('clustertype').value;
  var start = new Date();

  if (clusterType === 'markerclusterer' || clusterType === 'markerclustererplus') {
    speedTest.markerClusterer = new MarkerClusterer(speedTest.map, speedTest.markers);
    return;
  } else if (clusterType === 'clustermanager') {
    if(window.console && $('firebugprofile').checked) { 
        console.profile(); 
    }
    speedTest.clusterMgr = new ClusterManager(speedTest.map, {
      markers    : speedTest.markers,
      precision  : 2,
      icon_color : "FFFF33"
      });
    speedTest.clusterMgr.show();
  } else {
    if(window.console && $('firebugprofile').checked) { 
        console.profile(); 
    }
    for (var i = 0, marker; marker = speedTest.markers[i]; i++) {
      marker.setMap(speedTest.map);
    }
  }
  var end = new Date();
  $('timetaken').innerHTML = end - start;
  if(window.console && $('firebugprofile').checked) { 
      console.profileEnd(); 
  }
};
