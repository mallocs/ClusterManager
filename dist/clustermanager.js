(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/****
* mallocs media industries
* http://www.mallocs.net
****/

/************************************************************************************************
 * Cluster Manager
 ************************************************************************************************/

/**
 * @name ClusterManager
 * @version 2.0
 * @author Marcus Ulrich
 * @fileoverview
 * This library creates and manages clusters for Google Maps API v3. It does two things to make maps 
 * with large numbers of markers more useable: 1) Combines markers in close proximity to each other 
 * based on zoom level into clusters, 2) Only adds markers in the current viewport (and optional 
 * padding) to the map.
 * <b>How it works</b>:<br/>
 * The manager sets up a dictionary for clusters and a dictionary for markers. Every marker that's 
 * added to the manager has a string created based on it's latitude, longitude, and zoom level and 
 * that's used to add it to the cluster dictionary. Nearby markers will hash to the same string so 
 * nothing has to be calculated. Nearby clusters are then combined.
 * Markers can be added with optional type and subtypes so subsets of markers can be shown and 
 * hidden. Markers with the same subtype will still be clustered together, but can be shown or 
 * hidden seperately. Markers with the same type will be clustered together and can also be hidden
 * or shown seperately.
 * The function used to create the clusters is stored and this function can be overridden for 
 * greater control of the look and/or behavior of the clusters for each marker type.
 */

/***************************************************************************************************
 * Cluster Manager
 **************************************************************************************************/

"use strict";

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

var _utils = require("./utils");

var _LazyMarker = require("./LazyMarker");

var _LazyMarker2 = _interopRequireDefault(_LazyMarker);

window.ClusterManager = ClusterManager || {};

/**
 * Creates a new Cluster Manager for clustering markers on a V3 Google map.
 *
 * @param {GMap3} map The map that the markers should be added to.
 * @param {object} [opts] Options for configuring the behavior of the clustering. Defaults are 
 * applied in resetManager.
 * @param {google.maps.Marker[]} [opts.markers] Markers to add to the manager.
 * @param {function} [opts.zoom_to_precision=function(zoom_level) {return zoom_level + precision;}] 
 * A function to set the precision for each zoom level. 
 * @param {number} [opts.precision=2] A number between 0 and 27 that sets how small the cluster 
 * boxes will be. Higher numbers will make smaller boxes.
 * @param {string|object} [opts.icon_color="00CC00"] Sets the default icon color in HEX. Default is 
 * a bright green.
 * @param {number} [opts.padding=200] The amount of padding in pixels where markers not in the 
 * viewport will still be added to the map.
 * @param {boolean} [opts.visualize=false] For debugging. Will put a box around each cluster with at 
 * least one marker.
 * @param {number} [opts.cluster_by_distance=true] Combine neighboring clusters if they are close 
 * together. This is a little slower but makes more rounded clusters.
 * @param {number} [opts.cluster_distance_factor=2048000] Clusters are combined if they are within 
 * this distance: cluster_distance_factor*Math.pow(2, -precision+2)
 * @constructor
 */

function ClusterManager(map, opts) {
    var me = this;
    opts = opts || {};
    this.map = map;
    this.setMap(map);
    this.resetManager(opts);
    this.setPrecision(this.zoomToPrecision(this.map.getZoom()));
    google.maps.event.addDomListener(map, "dragstart", function () {
        me.mapDragging = true;
    });
    google.maps.event.addDomListener(map, "dragend", function () {
        me.mapDragging = false;
        me._onMapMoveEnd();
    });
    google.maps.event.addDomListener(map, "center_changed", function () {
        if (!me.mapDragging) me._onMapMoveEnd();
    });
    google.maps.event.addDomListener(map, "zoom_changed", function () {
        me._onMapMoveEnd();
    });
    if (typeof opts.markers !== "undefined") this.addMarkers(opts.markers);
}

ClusterManager.prototype = new google.maps.OverlayView();
/**
 * @ignore
 * This is implemented only so we can tell when the map is ready and to get the custom overlay 
 * functionality.
 */
ClusterManager.prototype.onAdd = function () {
    this.ready_ = true;
    google.maps.event.trigger(this, "ready_");
};

/**
 * @ignore
 */
ClusterManager.prototype.draw = function () {};

/**
 * Sets the marker and clusters back to the inital state.
 *
 * @param {object} [opts] Options for configuring the behavior of the clustering. Defaults are 
 * applied in resetManager.
 * @param {function} [opts.zoom_to_precision=function(zoom_level) {return zoom_level + precision;}] 
 * A function to set the precision for each zoom level. 
 * @param {number} [opts.precision=2] A number between 0 and 27 that sets how small the cluster 
 * boxes will be. Higher numbers will make smaller boxes.
 * @param {string|object} [opts.icon_color="00CC00"] Sets the default icon color in HEX. Default is 
 * a bright green.
 * @param {number} [opts.padding=200] The amount of padding in pixels where markers not in the 
 * viewport will still be added to the map.
 * @param {boolean} [opts.visualize=false] For debugging. Will put a box around each cluster with at 
 * least one marker.
 * @param {number} [opts.cluster_by_distance=true] Combine neighboring clusters if they are close 
 * together. This is a little slower but makes more rounded clusters.
 * @param {number} [opts.cluster_distance_factor=2048000] Clusters are combined if they are within 
 * this distance: cluster_distance_factor*Math.pow(2, -precision+2)
 */
ClusterManager.prototype.resetManager = function (opts) {
    this.markers = {}; //hold markers by type, then subtype.
    this.clusters = {}; //define clusters by precision, type, then geobox.
    this.cluster_fns = {}; //store cluster function for building the cluster markers.
    this.cluster_meta = {}; //marker counts, etc
    var precision = opts.precision >= 0 && opts.precision <= 27 ? opts.precision : 2;
    opts = (0, _utils.applyDefaults)({
        padding: 200,
        visualize: false,
        zoom_to_precision: function zoom_to_precision(zoom_level) {
            return zoom_level + precision;
        },
        cluster_by_distance: true,
        cluster_distance_factor: 2048000,
        icon_color: "00CC00"
    }, opts);
    this.opts = opts;
};

/**
 * Sets the current level of precision.
 * To speed up clustering and reduce memory, only the clusters for the current precision are 
 * calculated so changing the precision may take extra time to calculate clusters at the new 
 * precision.
 *
 * @param {number} precision The level to set the precision to. Currently, must be from 1 to 49.
 * @private
 */
ClusterManager.prototype.setPrecision = function (precision) {
    if (precision >= 50 || precision < 0) return;
    this.current_precision_ = precision;
    this.clear();
    if (typeof this.clusters[precision] === "undefined") {
        var markers = this.getMarkers();
        for (var i = 0, length = markers.length; i < length; i++) {
            var marker = markers[i];
            if (this.getMarkerMeta(marker).subtype !== "cluster") {
                this.addToCluster(marker, this.getMarkerMeta(marker).type, precision);
            }
        }
    }
    this.cluster();
    this.updateMarkers();
};

/**
 * Gets the current precision of the clusterer.
 *
 * @returns {number} The current precision.
 */
ClusterManager.prototype.getPrecision = function () {
    return this.current_precision_;
};

/**
 * Gets a hash based on latitude, longitude and precision. Higher precisions are geographically 
 * smaller areas. 
 * Since distance between degrees of longitude varies based on latitude: 
 *     (pi/180)*(6,378,137.0 meters)cos(degrees latitude)
 * the area covered by a given geohash precision will get smaller as it approaches the poles 
 * (cos(90 degrees) = 0). 
 * If you visualize the boxes, however, they will look larger based on the map projection.
 * The chart below shows the width covered by a given geohash at each precision level using 49 bits.
 * prec width		width of lat
 * 	(lat/lng)	(meters)
 * 2	140.737488	15666825.5392391m
 * 3	70.3687443	7833412.76961958m
 * 4	35.1843720	3916706.3848097343m
 * 5	17.5921860	1958353.1924048115m
 * 6	8.79609302	979176.5962023503m
 * 7	4.39804651	489588.2981011198m
 * 8	2.19902325	244794.14905050377m
 * 9	1.09951162	122397.07452519651m
 * 10	0.54975581	61198.53726254289m
 * 11	0.27487790	30599.268631216073m
 * 12	0.13743895	15299.63431555425m
 * 13	0.06871947	7649.817157720176m
 * 14	0.03435973	3824.9085788063016m
 * 15	0.01717986	1912.4542893462008m
 * 16	0.00858993	956.2271446193143m
 * 17	0.00429496	478.11357225428907m
 * 18	0.00214748	239.05678607177646m
 * 19	0.00107374	119.52839298052015m
 * 20	0.00053687	59.76419643331005m
 * 21	0.00026843	29.882098162868893m
 * 22	0.00013421	14.941049026066368m
 * 23	0.00006710	7.47052445608316m
 * 24	0.00003355	3.735262174255446m
 * 25	0.00001677	1.867631030177699m
 * 26	0.00000838	0.9338154597207706m
 * 27	0.00000419	0.46690767607425154m
 * 28	0.00000209	0.233453784250992m
 * 29	0.00000104	0.11672683517547201m
 * 30	5.24287e-7	0.05836336221965714m
 * 31	2.62142e-7	0.02918162257785948m
 * 32	1.31070e-7	0.014590754338905755m
 * 33	6.55349e-8	0.007295320219428895m
 * 34	3.27669e-8	0.0036476047416355755m
 * 35	1.63829e-8	0.0018237454207938048m
 * 36	8.19099e-9	0.0009118173423180302m
 * 37	4.09499e-9	0.0004558533030801429m
 * 38	2.04701e-9	0.00022787286540630993m
 * 39	1.02301e-9	0.0001138810646242828m
 * 40	5.10993e-10	0.00005688358228815859m
 * 41	2.54999e-10	0.000028386423065207123m
 * 42	1.27016e-10	0.000014139425398842023m
 * 43	6.30109e-11	0.00000701434462054884m
 * 44	3.10080e-11	0.0000034518042314022482m
 * 45	1.50066e-11	0.0000016705340368289525m
 * 46	6.99174e-12	7.783169944316711e-7m
 * 47	3.01270e-12	3.353723634542973e-7m
 * 48	9.94759e-13	1.1073615774434343e-7m
 * 
 * @param {number} lat Latitude. Value is clamped to the nearest value in [-90.0, 90.0];
 * @param {number} lng Longitude. Value is wrapped to stay within [-180, 180);
 * @param {number} precision An integer representing the number of bits to take from the 
 *                           untruncated latitude and longitude hashes.
 * @returns {string} geohash A binary hash string with a length twice the precision.
 */
ClusterManager.prototype.getGeohash = function (lat, lng, precision) {
    lat = Math.min(lat, 90);
    lat = Math.max(lat, -90);
    lng = Math.abs((lng + 180) % 360) - 180;

    if (precision <= 0) return "";
    var max_power = 12; //This is the limit for maximum range of decimal numbers in javascript.
    // Make the latitude and longitude positive and then mulitiply them by 10^12 to get rid of
    // as many decimal places as possible. Then change this to binary.
    var latBase = parseInt((lat + 90) * Math.pow(10, max_power)).toString(2);
    var lngBase = parseInt((lng + 180) * Math.pow(10, max_power)).toString(2);
    //Pad the front with zeros to make sure latitude and longitude are 49 bits.
    var fortyninezeros = "0000000000000000000000000000000000000000000000000";
    var latHash = fortyninezeros.substr(0, 49 - latBase.length) + latBase;
    var lngHash = fortyninezeros.substr(0, 49 - lngBase.length) + lngBase;
    //Take bits from the front based on the precision.
    //Concatinate the latitude and longitude strings.
    var geohash = latHash.substr(0, precision) + lngHash.substr(0, precision);
    return geohash;
};

/**
 * Given a geohash, this returns the bounds on it's range. The inverse of getGeohash.
 * 
 * @param {string} geohash A string representing the geobox.
 * @returns {google.maps.LatLngBounds} The bounds on the geobox. 
 */
ClusterManager.prototype.geohashGetLatLngBounds = function (geohash) {
    var max_power = 12;
    var precision = this.geohashGetPrecision(geohash);
    var fortyninezeros = "0000000000000000000000000000000000000000000000000";
    var latMinHashBin = geohash.substr(0, precision) + fortyninezeros.substr(0, 49 - precision);
    var lngMinHashBin = geohash.substr(precision, geohash.length) + fortyninezeros.substr(0, 49 - precision);
    var fortynineones = "1111111111111111111111111111111111111111111111111";
    var latMaxHashBin = geohash.substr(0, precision) + fortynineones.substr(0, 49 - precision);
    var lngMaxHashBin = geohash.substr(precision, geohash.length) + fortynineones.substr(0, 49 - precision);
    var latMinHashDec = parseInt(latMinHashBin, 2);
    var lngMinHashDec = parseInt(lngMinHashBin, 2);
    var latMaxHashDec = parseInt(latMaxHashBin, 2);
    var lngMaxHashDec = parseInt(lngMaxHashBin, 2);
    var latMin = Math.max(-90, latMinHashDec / Math.pow(10, max_power) - 90);
    var lngMin = Math.max(-180, lngMinHashDec / Math.pow(10, max_power) - 180);
    var latMax = Math.min(90, latMaxHashDec / Math.pow(10, max_power) - 90);
    var lngMax = Math.min(180, lngMaxHashDec / Math.pow(10, max_power) - 180);
    return new google.maps.LatLngBounds(new google.maps.LatLng(latMin, lngMin), new google.maps.LatLng(latMax, lngMax));
};

/**
 * Derives the precision from a geohash string.
 *
 * @param {string} geohash The geohash to find the precision of.
 * @returns {number} The derived precision of the geobox.
 * @private
 */
ClusterManager.prototype.geohashGetPrecision = function (geohash) {
    var precision = geohash.length / 2;
    if (parseInt(precision) !== precision || precision < 0 || precision >= 50) return undefined;
    return precision;
};

/**
 * Gets the boxes surrounding the given box and only returns boxes that have at least one marker.
 *
 * @param {string} box_str The geobox to find the neighbors of.
 * @param {string} type The type of the geobox to find the neighbors of.
 * @returns {string[]} The strings for the geoboxes with at least one marker neighboring the input 
 * geobox.
 * @private
 */
ClusterManager.prototype.getNeighborBoxes = function (box_str, type) {
    var bounds = this.geohashGetLatLngBounds(box_str);
    var precision = this.geohashGetPrecision(box_str);
    var boxString1 = this.getGeohash(bounds.getSouthWest().lat() + 0.0001, bounds.getSouthWest().lng() - 0.0001, precision);
    var boxString2 = this.getGeohash(bounds.getSouthWest().lat() - 0.0001, bounds.getSouthWest().lng() + 0.0001, precision);
    var boxString3 = this.getGeohash(bounds.getNorthEast().lat() + 0.0001, bounds.getNorthEast().lng() - 0.0001, precision);
    var boxString4 = this.getGeohash(bounds.getNorthEast().lat() - 0.0001, bounds.getNorthEast().lng() + 0.0001, precision);
    var boxString5 = this.getGeohash(bounds.getSouthWest().lat() + 0.0001, bounds.getSouthWest().lng() + 0.0001, precision);
    var boxString6 = this.getGeohash(bounds.getSouthWest().lat() - 0.0001, bounds.getSouthWest().lng() - 0.0001, precision);
    var boxString7 = this.getGeohash(bounds.getNorthEast().lat() + 0.0001, bounds.getNorthEast().lng() + 0.0001, precision);
    var boxString8 = this.getGeohash(bounds.getNorthEast().lat() - 0.0001, bounds.getNorthEast().lng() - 0.0001, precision);
    var boxStrings = [boxString1, boxString2, boxString3, boxString4, boxString5, boxString6, boxString7, boxString8];
    for (var i = 0, neighbors = [], boxString; boxString = boxStrings[i]; i++) {
        if (typeof this.clusters[precision][type][boxString] !== "undefined" && boxString !== box_str) {
            neighbors.push(boxString);
        }
    }
    return neighbors;
};

/**
 * Given a geohash, this returns a polygon covering the box's bounds. Mostly for debugging to 
 * visualize geoboxes.
 *
 * @param {string} geohash A string representing the geobox.
 * @param {object} [opts] Options for the appearance of the polygon.
 * @param {GMap3}  [opts.map=this.map] The map to add the polygon to.
 * @param {string} [opts.strokeColor] 
 * @param {string} [opts.strokeWeight]
 * @param {string} [opts.strokeOpacity] 
 * @param {string} [opts.fillColor] 
 * @param {string} [opts.fillOpacity] .
 * @returns {google.maps.Polygon} A polygon covering the box's bounds.
 */
ClusterManager.prototype.boxToPolygon = function (geohash, opts) {
    opts = (0, _utils.applyDefaults)({
        map: this.map,
        strokeColor: "#f33f00",
        strokeWeight: 5,
        strokeOpacity: 1,
        fillColor: "#ff0000",
        fillOpacity: 0.2
    }, opts);
    var bounds = this.geohashGetLatLngBounds(geohash); //TODO:change back!!
    var ne = bounds.getNorthEast();
    var sw = bounds.getSouthWest();
    var polygon = new google.maps.Polygon({
        paths: opts.paths || [ne, new google.maps.LatLng(ne.lat(), sw.lng()), sw, new google.maps.LatLng(sw.lat(), ne.lng()), ne],
        strokeColor: opts.strokeColor,
        strokeWeight: opts.strokeWeight,
        strokeOpacity: opts.strokeOpacity,
        fillColor: opts.fillColor,
        fillOpacity: opts.fillOpacity,
        map: opts.map
    });
    return polygon;
};

/**
 * Tests whether a geobox touches a given bounds. Padding expands the range of the bounds based on 
 * viewport pixels.
 *
 * @param {string} geohash A string representing the geobox.
 * @param {google.maps.LatLngBounds} bounds The bounds to be tested.
 * @param {number} [padding] The number of pixels to expand the bounds. 
 * @returns {boolean} True if any part of the geobox touches the bounds expanded by the padding.
 * @private
 */
ClusterManager.prototype.boxInBounds = function (geohash, bounds, padding) {
    //make a new LatLngBounds so we don't have any side effects on our map bounds.
    var newBounds = new google.maps.LatLngBounds(this.map.getBounds().getSouthWest(), this.map.getBounds().getNorthEast());
    if (typeof padding !== "undefined") {
        var proj = this.map.getProjection();
        var scale = Math.pow(2, this.map.getZoom());
        var pixelOffset = new google.maps.Point(padding / scale || 0, padding / scale || 0);
        var nePoint = proj.fromLatLngToPoint(bounds.getNorthEast());
        var swPoint = proj.fromLatLngToPoint(bounds.getSouthWest());
        var newNEPoint = new google.maps.Point(nePoint.x + pixelOffset.x, nePoint.y - pixelOffset.y);
        var newSWPoint = new google.maps.Point(swPoint.x - pixelOffset.x, swPoint.y + pixelOffset.y);
        var newNE = proj.fromPointToLatLng(newNEPoint);
        var newSW = proj.fromPointToLatLng(newSWPoint);
        newBounds.extend(newNE);
        newBounds.extend(newSW);
    }
    var boxBounds = this.geohashGetLatLngBounds(geohash);
    if (newBounds.contains(boxBounds.getNorthEast()) || newBounds.contains(boxBounds.getSouthWest()) || boxBounds.toSpan().lat() === 180) return true;else return false;
};

/**
 * Use this to add markers in one batch through an array.
 *
 * @param {google.maps.Marker[]} markers An array of markers.
 * @param {string} type The type for the markers being added.
 * @param {string} subtype The subtype for the markers being added.
 */
ClusterManager.prototype.addMarkers = function (markers, type, subtype) {
    if (Object.prototype.toString.call(markers) === "[object Array]") {

        for (var i = 0, length = markers.length; i < length; i++) {
            var marker = markers[i];
            this.addMarker(marker, {
                type: type,
                subtype: subtype
            });
        }
    }
};

/**
 * Add a single marker to the map. Stores an associative array for looking for marker types so we 
 * can cluster by type. Doesn't build clusters or add them to the map. Each marker can have an opt 
 * type and subtype to cluster by. 
 *
 * @param {google.maps.Marker} marker The marker to add. 
 * @param {object} [opts] Options for the behavior of the marker in the clusters.
 * @param {string} [opts.type] A string that is used to sort which markers to cluster.
 * @param {string} [opts.subtype] A string that is used to show/hide subsets of markers of a given 
 * type.
 * @param {boolean} [opts.hidden] Set true to make a marker disappear from the map even if it's in 
 * the viewport.
 * @param {boolean} [opts.visible] Set true if the marker is visible in the viewport. 
 * @param {string} [opts.summary] The summary text that appears in the cluster's infowindow. 
 * Clicking on the text opens the markers infowindow.
 */
ClusterManager.prototype.addMarker = function (raw_marker, opts) {
    if (typeof opts === "undefined") opts = this.getMarkerMeta(raw_marker);
    var marker = new _LazyMarker2["default"](raw_marker);

    //Set when the marker is visible in the viewport and not hidden.
    //Set when we want to hide the marker even if it's in the viewport.
    var defaults = {
        type: "generic",
        subtype: "generic",
        hidden: true,
        visible: false
    };
    opts = (0, _utils.applyDefaults)(defaults, opts);
    var type = opts.type,
        subtype = opts.subtype;
    //if this is the first marker of the type, save the cluster function.
    if (typeof this.markers[type] === "undefined") {
        this.markers[type] = {};
        this.cluster_meta[type] = {
            count: {
                total: 0,
                visible: 0,
                cluster: 0
            }
        };
    }
    if (typeof this.cluster_fns[type] === "undefined") {
        this.setClusterFn(type, this.createClusterMarker);
    }
    //if this is the first marker of the subtype, set up an empty array to save it in.
    if (typeof this.markers[type][subtype] === "undefined") {
        this.markers[type][subtype] = [];
    }
    this.markers[type][subtype].push(marker);
    if (subtype !== "cluster") {
        this.cluster_meta[type]["count"]["total"] += 1;
        this.addToCluster(marker, type, this.getPrecision());
    }
    if (typeof opts.summary === "undefined") {
        var capType = opts.type.charAt(0).toUpperCase() + opts.type.slice(1);
        opts.summary = typeof marker.getTitle() === "undefined" ? capType + " marker " + this.count(opts.type, "total") : marker.getTitle();
    }
    this.setMarkerMeta(marker, opts);
};

/**
 * Returns the number of markers of a particular type.
 *
 * @param {number} type The type of marker to count.
 * @returns {number} The number of markers of a particular type.
 */
ClusterManager.prototype.count = function (type, count_type) {
    return this.cluster_meta[type]["count"][count_type];
};

/**
 * Adds a marker to a cluster object. Does not create the cluster markers.
 *
 * @param {google.maps.Marker} marker The marker to add. 
 * @param {string} type The type of the marker to add. This will be used to form cluster groups. If 
 * no type is given it is assigned type "generic".
 * @param {number} precision The precision to cluster at.
 * @param {string} [geohash] Force a marker into a particular geobox rather than its default one.
 * @private
 */
ClusterManager.prototype.addToCluster = function (marker, type, precision, geohash) {
    var clusters = this.clusters;
    var markerLL = marker.getLatLng();
    var markerLat = markerLL.latitude;
    var markerLng = markerLL.longitude;
    if (typeof clusters[precision] === "undefined") {
        clusters[precision] = {};
    }
    if (typeof clusters[precision][type] === "undefined") {
        clusters[precision][type] = {};
    }
    var cluster = clusters[precision][type];
    if (typeof geohash === "undefined") {
        geohash = this.getGeohash(markerLat, markerLng, precision);
    }
    if (typeof cluster[geohash] !== "undefined") {
        cluster[geohash]["markers"].push(marker);
        var length = cluster[geohash]["markers"].length;
        var lat = (length - 1) / length * cluster[geohash]["center"][0] + markerLat / length;
        var lng = (length - 1) / length * cluster[geohash]["center"][1] + markerLng / length;
        cluster[geohash]["center"] = [lat, lng];
    } else {
        cluster[geohash] = {
            cluster: false,
            markers: [marker],
            center: [markerLat, markerLng]
        };
    }
};

/**
 * Removes a marker from a cluster and resets the cluster box's properties.
 *
 * @param {google.maps.Marker} marker The marker to remove.
 * @param {string} geohash The geohash to remove the marker from.
 * @private
 */
ClusterManager.prototype.removeFromCluster = function (marker, geohash) {
    var precision = this.geohashGetPrecision(geohash);
    var type = this.getMarkerMeta(marker).type;
    var geoBox = this.clusters[precision][type][geohash];
    if (geoBox["markers"].length === 1) {
        delete this.clusters[precision][type][geohash];
    } else if (geoBox["markers"].length > 1) {
        for (var i = 0, new_markers = [], center_lat = 0, center_lng = 0, test_marker; test_marker = geoBox["markers"][i]; i++) {
            if (test_marker !== marker) {
                new_markers.push(test_marker);
                center_lat = center_lat + test_marker.getLatLng().latitude;
                center_lng = center_lng + test_marker.getLatLng().longitude;
            }
        }
        center_lat = center_lat / new_markers.length;
        center_lng = center_lng / new_markers.length;
        geoBox["center"] = [center_lat, center_lng];
        geoBox["markers"] = new_markers;
        geoBox["cluster"] = false;
        this.clusters[precision][type][geohash] = geoBox;
    }
};

/**
 * This takes two geoboxes and puts all the markers into the one with more markers or the first one.
 * 
 * @param {string} box_str1 First box to combine.
 * @param {string} box_str2 Second box to combine.
 * @param {string} type Type of the boxes since this can't be derived.
 * @private
 */
ClusterManager.prototype.combineBoxes = function (box_str1, box_str2, type) {
    var precision = this.geohashGetPrecision(box_str1);
    if (this.clusters[precision][type][box_str1]["markers"].length < this.clusters[precision][type][box_str2]["markers"].length) {
        var temp = box_str1;
        box_str1 = box_str2;
        box_str2 = temp;
    }
    var length = this.clusters[precision][type][box_str2]["markers"].length;
    for (var i = length - 1, marker; i >= 0; i--) {
        marker = this.clusters[precision][type][box_str2]["markers"][i];
        this.removeFromCluster(marker, box_str2);
        this.addToCluster(marker, type, precision, box_str1);
    }
};

/**
 * This checks neighboring geoboxes to see if they are centered within a minimum distance. This 
 * makes the clusters less box shaped, but also takes extra time.
 * 
 * @param {string} type The type of the markers to cluster.
 * @private
 */
ClusterManager.prototype.combineClustersByDistance = function (type) {
    var precision = this.getPrecision();
    var clusters = this.clusters;
    var clusterDistanceFactor = this.opts.cluster_distance_factor || 2048000;
    for (var boxStr in clusters[precision][type]) {
        var neighbors = this.getNeighborBoxes(boxStr, type);
        var distance = clusterDistanceFactor * Math.pow(2, -precision + 2);
        var clusterCenter = clusters[precision][type][boxStr]["center"];
        /***
                new google.maps.Circle({
                        strokeColor   : '#FF0000',
                        strokeOpacity : 0.8,
                        strokeWeight  : 2,
                        fillColor     : '#FF0000',
                        fillOpacity   : 0.35,
                        map           : this.map,
                        center        : new google.maps.LatLng(clusterCenter[0], clusterCenter[1]),
                        radius        : distance});
        ***/
        for (var j = 0, result = 0, neighborStr; neighborStr = neighbors[j]; j++) {
            clusterCenter = clusters[precision][type][boxStr]["center"];
            var neighborCenter = clusters[precision][type][neighborStr]["center"];
            var currentDist = google.maps.geometry.spherical.computeDistanceBetween(new google.maps.LatLng(clusterCenter[0], clusterCenter[1]), new google.maps.LatLng(neighborCenter[0], neighborCenter[1]));
            if (currentDist < distance) {
                result = j;
                distance = currentDist;
            }
        }
        if (result) {
            neighborStr = neighbors[result];
            this.combineBoxes(boxStr, neighborStr, type);
        }
    }
};

/**
 * This builds the actual cluster markers and optionally combines boxes if the markers get too close 
 * together. It does not set up the cluster dictionary.
 *
 * @param {string} [type] The type to cluster. If none is given, this sets up the clusters for every 
 * group in the clusterer.
 * @private
 */
ClusterManager.prototype.cluster = function (type) {
    var precision = this.getPrecision();
    var clusters, marker, cluster_markers, i;
    if (typeof type === "undefined") {
        clusters = this.clusters[precision];
        for (type in clusters) {
            this.cluster(type);
        }
        return;
    }
    if (typeof this.markers[type] === "undefined") return; //no markers to cluster
    if (typeof this.markers[type]["cluster"] !== "undefined") {
        for (i = 0, marker; marker = this.markers[type]["cluster"][i]; i++) {
            marker.setVisible(false);
        }
    }
    this.markers[type]["cluster"] = [];
    this.cluster_meta[type]["count"]["cluster"] = 0;
    clusters = this.clusters;
    if (this.opts.cluster_by_distance) this.combineClustersByDistance(type);
    for (var boxStr in clusters[precision][type]) {
        //visualize the boxes by adding polygons to the map for debugging.
        if (this.opts.visualize) this.boxToPolygon(boxStr).setMap(this.map);
        var cluster = clusters[precision][type][boxStr];
        for (i = 0, cluster_markers = []; marker = cluster["markers"][i]; i++) {
            var meta = this.getMarkerMeta(marker);
            if (typeof meta.hidden === "undefined" || !meta.hidden) {
                cluster_markers.push(marker);
            }
        }
        if (cluster_markers.length > 1) {
            cluster["cluster"] = this.cluster_fns[type](cluster_markers, cluster["center"][0], cluster["center"][1], this);
            this.addMarker(cluster["cluster"], {
                type: type,
                subtype: "cluster",
                hidden: false
            });
            this.cluster_meta[type]["count"]["cluster"] += 1;
        } else {
            cluster["cluster"] = false;
        }
    }
};

/**
 * Gets the markers of a given type and/or subtype. Returns all markers if passed no parameters.
 *
 * @param {string} [type] The type of the markers to return.
 * @param {string} [subtype] The subtype of the markers to return.
 * @param {string|boolean} [visible] Pass "all" to get markers that aren't clusters.
                                     Pass true to get all markers that are visible and not hidden.
 * @returns {google.maps.Marker[]} The markers of the given type.
 */
ClusterManager.prototype.getMarkers = function (type, subtype, visible) {
    var markers = [];
    if (this.markers === {}) return []; //no markers of any type.
    if (typeof type === "undefined") {
        for (type in this.markers) {
            for (subtype in this.markers[type]) {
                markers = markers.concat(this.markers[type][subtype]);
            }
        }
    } else if (typeof subtype === "undefined") {
        for (subtype in this.markers[type]) {
            //access all subcategories with a string.
            markers = markers.concat(this.markers[type][subtype]);
        }
    } else {
        try {
            markers = this.markers[type][subtype] || [];
        } catch (err) {
            markers = [];
        }
    }
    if (typeof visible === "undefined") return markers;

    for (var i = 0, final_markers = [], length = markers.length; i < length; i++) {
        var marker = markers[i];
        var meta = this.getMarkerMeta(marker);
        if (visible === "all" || meta.hidden !== visible && meta.visible === visible && typeof marker !== "function" && meta.type !== "cluster") {
            final_markers.push(marker);
        }
    }
    return final_markers;
};

/**
 * Handles any change in the map viewport. Calls updateMarkers with a timeout so it doesn't lock up 
 * the map.
 * @private
 */
ClusterManager.prototype._onMapMoveEnd = function () {
    var me = this;
    if (typeof me.moveTimeout !== "undefined") {
        clearTimeout(me.moveTimeout);
        delete me.moveTimeout;
    }
    var precision = me.zoomToPrecision(me.map.getZoom());
    if (me.getPrecision() !== precision) {
        me.setPrecision(precision);
    } else {
        me.moveTimeout = setTimeout(function () {
            delete me.moveTimeout;
            me.updateMarkers();
        }, 100);
    }
};

/**
 * Shows markers of an input type.
 *
 * @param {string} type The type of markers to show.
 * @param {string} subtype The subtype of markers to show.
 */
ClusterManager.prototype.show = function (type, subtype) {
    this._showHide(type, subtype, false);
};

/**
 * Hides markers of the input type.
 *
 * @param {string} type The type of markers to hide.
 * @param {string} subtype The subtype of markers to hide.
 */
ClusterManager.prototype.hide = function (type, subtype) {
    this._showHide(type, subtype, true);
};

/**
 * Does the actual showing or hiding.
 * @private
 */
ClusterManager.prototype._showHide = function (type, subtype, hide) {
    var me = this;
    var markers = this.getMarkers(type, subtype);
    for (var i = 0, length = markers.length; i < length; i++) {
        var marker = markers[i];
        this.getMarkerMeta(marker).hidden = hide;
    }
    if (this.ready_) this._lagUpdate(type);else {
        google.maps.event.addListenerOnce(this, "ready_", function () {
            me._lagUpdate(type);
        });
    }
};

/**
 * Since clustering takes time, this sets up a delay before reclustering.
 * 
 * @param {string} type The type to update.
 * @private
 */
ClusterManager.prototype._lagUpdate = function (type) {
    var me = this;
    if (typeof this.processingTimeout !== "undefined") {
        clearTimeout(me.processingTimeout);
        delete me.processingTimeout;
    }
    this.processingTimeout = setTimeout(function () {
        delete me.processingTimeout;
        me.clear(type);
        me.cluster(type);
        me.updateMarkers();
    }, 100);
};

/**
 * This sets a cluster type to an empty state.
 *
 * @param {string} [type] The type to reset. If none is given, every type in the clusterer is reset.
 */
ClusterManager.prototype.reset = function (type) {
    if (typeof type === "undefined") {
        var clusters = this.clusters[this.getPrecision()];
        for (type in clusters) {
            this.reset(type);
        }
        return;
    }
    this.clear(type);
    //this for loop should probably be a reset cluster function
    for (var precision in this.clusters) {
        delete this.clusters[precision][type];
        this.clusters[precision][type] = {};
    }
    delete this.markers[type];
    this.markers[type] = {};
};

/**
 * This removes the markers from the map. Use reset if you want to actually get rid of the 
 * markers.
 *  
 * @param {string} [type] The type to clear. If it is not passed, all markers managed by the 
 * clusterer will be cleared.
 */
ClusterManager.prototype.clear = function (type) {
    var markers = this.getMarkers(type);
    for (var i = 0, length = markers.length; i < length; i++) {
        var marker = markers[i];
        marker.setMap(null);
        this.getMarkerMeta(marker).visible = false;
    }
    if (typeof type !== "undefined" && this.cluster_meta && this.cluster_meta[type]) {
        this.cluster_meta[type]["count"]["visible"] = 0;
    } else {
        for (var item in this.cluster_meta) {
            this.cluster_meta[item]["count"]["visible"] = 0;
        }
    }
};

/**
 * Convert a Google map zoom level to a clusterer precision.
 *
 * @param {number} zoom_level The Google map's zoom level
 * @returns {number} The precision of the input zoom level. 
 */
ClusterManager.prototype.zoomToPrecision = function (zoom_level) {
    return this.opts.zoom_to_precision(zoom_level);
};

/**
 * Updates the markers on the map based on the current viewport with padding.
 * @private
 */
ClusterManager.prototype.updateMarkers = function () {
    var marker, meta, length, i;
    var precision = this.getPrecision();
    var currentBounds = this.map.getBounds();
    var cluster = this.clusters[precision];
    for (var type in cluster) {
        var type_cluster = cluster[type];
        for (var box in type_cluster) {
            var cluster_box = type_cluster[box];
            var cluster_box_meta = this.getMarkerMeta(cluster_box["cluster"]);
            if (this.boxInBounds(box, currentBounds, this.opts.padding)) {
                if (cluster_box["cluster"]) {
                    if (!cluster_box_meta.hidden && !cluster_box_meta.visible) {
                        for (i = 0, length = cluster_box["markers"].length; i < length; i++) {
                            marker = cluster_box["markers"][i];
                            this.getMarkerMeta(marker).visible = true;
                        }
                        cluster_box["cluster"].setMap(this.map);
                        cluster_box["cluster"].setVisible(true);
                        cluster_box_meta.visible = true;
                        this.cluster_meta[type]["count"]["visible"] += 1;
                    }
                } else {
                    marker = cluster_box["markers"][0];
                    meta = this.getMarkerMeta(marker);
                    if (!meta.hidden && !meta.visible) {
                        marker.setMap(this.map);
                        marker.setVisible(true);
                        meta.visible = true;
                        this.cluster_meta[type]["count"]["visible"] += 1;
                    }
                }
            } else {
                if (cluster_box["cluster"]) {
                    cluster_box["cluster"].setVisible(false);
                    if (cluster_box_meta.visible) this.cluster_meta[type]["count"]["visible"] -= 1;
                    cluster_box_meta.visible = false;
                } else {
                    for (i = 0, length = cluster_box["markers"].length; i < length; i++) {
                        marker = cluster_box["markers"][i];
                        meta = this.getMarkerMeta(marker);
                        marker.setVisible(false);
                        if (meta.visible) this.cluster_meta[type]["count"]["visible"] -= 1;
                        meta.visible = false;
                    }
                }
            }
        }
    }
};

/**
 * Sets the clustering function for a given type of markers. 
 * 
 * @param {string} type The type the clustering function is set up for.
 * @param {function} fn The function that is used to cluster the markers. See
 *                      ClusterManager.createClusterMarker for an example of
 *                      its parameters and return value.
 */
ClusterManager.prototype.setClusterFn = function (type, fn) {
    this.cluster_fns[type] = fn;
};

/**
 * Sets a marker's meta properties. Properties already set are treated as defaults.
 * 
 * @param {google.maps.Marker} marker
 * @param {object} meta
 */
ClusterManager.prototype.setMarkerMeta = function (marker, meta) {
    var defaults = (0, _utils.applyDefaults)(meta, marker._cluster_meta);
    marker._cluster_meta = (0, _utils.applyDefaults)(defaults, meta);
};

/**
 * Gets a marker's meta properties.
 * 
 * @param {google.maps.Marker} marker
 * @returns {object} The object with extra data about the marker.
 */
ClusterManager.prototype.getMarkerMeta = function (marker) {
    try {
        return marker._cluster_meta;
    } catch (err) {
        marker._cluster_meta = {};
        return marker._cluster_meta;
    }
};

/**
 * A free function for creating cluster icons. At precisions greater than 10, the markers will be
 * precise looking pins. At precisions less then 10, the markers will be circles that float above
 * the map.
 * 
 * @param {number} number The number of markers in the cluster.
 * @param {number} precision The precision of markers.
 * @param {string} icon_color A HEX color for the marker.
 * @param {string} [text_color="000000"] A HEX color for the text inside the markers.
 * @returns {object} An object containing the configuration options for a cluster icon.
 */
ClusterManager.prototype.createClusterIcon = function (number, precision, icon_color, text_color) {
    var iconOpts;
    text_color = text_color || "000000";
    if (precision > 10) {
        iconOpts = {
            "url": "http://chart.apis.google.com/chart?cht=d&chdp=mapsapi&chl=pin%27i\\%27[" + number + "%27-2%27f\\hv%27a\\]h\\]o\\" + icon_color + "%27fC\\" + text_color + "%27tC\\000000%27eC\\Lauto%27f\\&ext=.png",
            "size": new google.maps.Size(21, 34)
        };
    } else {
        var size = ((number + "").length - 1) * 6 + 24;
        iconOpts = {
            "size": new google.maps.Size(size, size),
            "anchor": new google.maps.Point(size / 2, size / 2),
            "shape": {
                coord: [size / 2, size / 2, size / 2],
                type: "circle"
            },
            "url": "http://chart.apis.google.com/chart?cht=it&chs=" + size + "x" + size + "&chco=" + icon_color + ",000000ff,ffffff01&chl=" + number + "&chx=" + text_color + ",0&chf=bg,s,00000000&ext=.png"
        };
    }
    return (0, _utils.createMarkerIconOpts)(iconOpts);
};

/**
 * A free function for creating cluster markers.
 * 
 * @param {google.maps.Marker[]} marker_list An array of markers to make a cluster icon for.
 * @param {number} center_lat The center latitude of the cluster.
 * @param {number} center_lng The center longitude of the cluster.
 * @param {ClusterManager} manager The ClusterManager object managing the cluster.
 * @returns {google.maps.Marker} The new cluster marker.
 */
ClusterManager.prototype.createClusterMarker = function (marker_list, center_lat, center_lng, manager) {
    var htmlEl = document.createElement("div");
    htmlEl.style.width = "400px";

    function markerClickClosure(marker) {
        return function (e) {
            google.maps.event.trigger(marker, "click", e);
        };
    }
    for (var i = 0, marker; marker = marker_list[i]; i++) {
        var markerSpan = document.createElement("span");
        markerSpan.innerHTML = "<b>" + manager.getMarkerMeta(marker).summary + "</b><br>";
        markerSpan.onclick = markerClickClosure(marker);
        markerSpan.style.color = "#334499";
        markerSpan.style.cursor = "pointer";
        htmlEl.appendChild(markerSpan);
        if (i >= 9) break;
    }
    if (marker_list.length > 10) {
        htmlEl.appendChild(document.createTextNode(marker_list.length - 10 + " more markers in this area. Zoom in for details."));
    }
    var icon_color = manager.opts.icon_color[manager.getMarkerMeta(marker_list[0]).type] || manager.opts.icon_color;
    var icon = manager.createClusterIcon(marker_list.length, manager.getPrecision(), icon_color);
    marker = manager.createMarker({
        position: new google.maps.LatLng(center_lat, center_lng),
        title: marker_list.length + " markers",
        content: htmlEl,
        summary: marker_list.length + " markers",
        icon: icon,
        shape: icon["shape"],
        zIndex: marker_list.length
    });
    return marker;
};

/**
 * A free function for creating marker icon opts.
 * 
 * @param {object} [opts] Options for configuring the appearance of the marker icon.
 * @param {number} [opts.width=32] The width of the icon.
 * @param {number} [opts.height=32] The height of the icon.
 * @param {string|object} [opts.icon_color="ff0000"] The HEX color of the icon or an associate array 
 * with a color for corresponding marker types.
 * @param {string} [opts.type] A type for the marker.
 * @param {string} [opts.strokeColor="000000"] The HEX color for icon's stroke.
 * @param {string} [opts.cornerColor="ffffff"] The HEX color for icon's corner.
 * @returns {object} An object that can be used to create a map icon.
 */
ClusterManager.prototype.createMarkerIconOpts = function (opts) {
    if (typeof opts === "undefined") opts = {};

    var default_icon_color = "ff0000";
    if (typeof this.opts !== "undefined" && typeof this.opts.icon_color !== "undefined") {
        if (typeof this.opts.icon_color === "string") {
            default_icon_color = this.opts.icon_color;
        } else if (typeof this.opts.icon_color === "object" && typeof opts.type !== "undefined" && typeof this.opts.icon_color[opts.type] === "string") {
            default_icon_color = this.opts.icon_color[opts.type];
        }
    }
    opts = (0, _utils.applyDefaults)({ icon_color: default_icon_color }, opts);

    return (0, _utils.createMarkerIconOpts)(opts);
};

ClusterManager.prototype.createMarkerData = function (opts) {
    var markerData = (0, _utils.createMarkerData)((0, _utils.applyDefaults)({ icon: this.createMarkerIconOpts(opts),
        map: this.map }, opts));
    this.setMarkerMeta(markerData, markerData); //TODO: need to get rid of this   

    return markerData;
};

/**
 * A free function for creating markers. In addition to the parameters below, you can pass any 
 * option listed in Google's reference:
 * https://developers.google.com/maps/documentation/javascript/reference#MarkerOptions
 * 
 * @param {object} [opts] Options for configuring the marker. 
 * @param {google.maps.Map} [opts.map=this.map] The map on which to display the marker. 
 * @param {boolean} [opts.visible=false] Make the marker visible initially.
 * @param {object} [opts.icon=this.createMarkerIconOpts(opts)] The marker's icon.
 * @param {function} [opts.fn] A function called when the marker is clicked.
 * @param {string} [opts.content="Marker"] If the marker does not have opts.fn defined, this 
 * determines the content of the infowindow displayed when the marker is clicked.
 */
ClusterManager.prototype.createMarker = function (opts) {
    var marker = (0, _utils.createMarker)(this.createMarkerData(opts));
    this.setMarkerMeta(marker, opts); //TODO: need to get rid of this   
    return marker;
};

},{"./LazyMarker":2,"./utils":3}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});

var _utils = require("./utils");

//TODO: make NormalizedMarker base class

function LazyMarker(raw_marker) {
    if (raw_marker.constructor === LazyMarker) return raw_marker;
    this.raw_marker = raw_marker;

    if (typeof raw_marker.setMap === "function") {
        this._marker = raw_marker;
    } else {
        this._marker = null;
    }
    google.maps.event.addListener(this, "click", function (e) {
        //marker hasn't been added to the map yet, so not visible
        if (!this._marker) this._marker = (0, _utils.createMarker)((0, _utils.applyDefaults)(this.raw_marker, { visible: false }));
        google.maps.event.trigger(this._marker, "click", e);
    });
}

LazyMarker.prototype.setVisible = function (visible) {
    if (this._marker) {
        this._marker.setVisible(visible);
    }
};

LazyMarker.prototype.setMap = function (map) {
    if (this._marker) {
        this._marker.setMap(map);
        return;
    }
    if (!map) return;

    var defaults = {
        map: map,
        title: this.raw_marker.title,
        content: ""
    };

    this._marker = (0, _utils.createMarker)((0, _utils.applyDefaults)(defaults, this.raw_marker));
    this._marker.setMap(map);
};

LazyMarker.prototype.getPosition = function () {
    if (this._marker && this._marker.getPosition()) {
        return this._marker.getPosition();
    }
    var latlng = this.getLatLng();
    this.raw_marker.position = new google.maps.LatLng(latlng.latitutde, latlng.longitude);
    return this.raw_marker.position;
};

LazyMarker.prototype.getLatLng = function () {
    if (this._marker && typeof this.raw_marker.latitude === "undefined") {
        this.raw_marker.position = this._marker.getPosition();
        this.raw_marker.latitude = this.raw_marker.position.lat();
        this.raw_marker.longitude = this.raw_marker.position.lng();
    }
    return {
        latitude: this.raw_marker.latitude,
        longitude: this.raw_marker.longitude
    };
};

LazyMarker.prototype.getTitle = function () {
    return this._marker && this._marker.getTitle() || this.raw_marker.title;
};

LazyMarker.prototype.setVisible = function (visible) {
    this._marker && this._marker.setVisible(visible);
};

exports["default"] = LazyMarker;
module.exports = exports["default"];

},{"./utils":3}],3:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.applyDefaults = applyDefaults;
exports.createMarkerIconOpts = createMarkerIconOpts;
exports.createMarkerData = createMarkerData;
exports.createMarker = createMarker;
/**
 * Tool for applying defaults. Any property in defaults will be overwritten by a corresponding
 * property in opts. If the property does not exist, the default remains. Only properties in 
 * defaults will be included in the final object.
 * 
 * @param {object} [defaults]
 * @param {object} [opts]
 * @returns {object} 
 */

function applyDefaults(defaults, opts) {
    if (typeof defaults !== "object") return {};
    if (typeof opts !== "object") return defaults;
    for (var index in defaults) {
        if (typeof opts[index] === "undefined") {
            opts[index] = defaults[index];
        }
    }
    return opts;
}

/**
 * A free function for creating marker icon opts.
 * 
 * @param {object} [opts] Options for configuring the appearance of the marker icon.
 * @param {number} [opts.width=32] The width of the icon.
 * @param {number} [opts.height=32] The height of the icon.
 * @param {string|object} [opts.icon_color="ff0000"] The HEX color of the icon or an associate array 
 * with a color for corresponding marker types.
 * @param {string} [opts.type] A type for the marker.
 * @param {string} [opts.strokeColor="000000"] The HEX color for icon's stroke.
 * @param {string} [opts.cornerColor="ffffff"] The HEX color for icon's corner.
 * @returns {object} An object that can be used to create a map icon.
 */

function createMarkerIconOpts(opts) {
    if (typeof opts === "undefined") opts = {};
    if (typeof opts.width === "undefined") opts.width = 32;
    if (typeof opts.height === "undefined") opts.height = 32;
    var width = opts.width,
        height = opts.height;

    var icon_color = "ff0000";
    // 1. opts.icon_color[opts.type]
    // 2. opts.icon_color
    // 3. mgr opts.icon_color[opts.type]
    // 3a. mgr opts.icon_color[opts.type] === undefined => "ff0000"
    // 4. mgr opts.icon_color
    // 5. "ff0000"
    if (typeof opts.icon_color !== "undefined") {
        if (typeof opts.icon_color === "string") {
            icon_color = opts.icon_color;
        } else if (typeof opts.icon_color === "object" && typeof opts.type !== "undefined" && typeof opts.icon_color[opts.type] === "string") {
            icon_color = opts.icon_color[opts.type];
        }
    }

    if (typeof opts.strokeColor === "undefined") opts.strokeColor = "000000";
    if (typeof opts.cornerColor === "undefined") opts.cornerColor = "ffffff";
    var baseUrl = "http://chart.apis.google.com/chart?cht=mm";
    var iconUrl = baseUrl + "&chs=" + width + "x" + height + "&chco=" + opts.cornerColor.replace("#", "") + "," + icon_color + "," + opts.strokeColor.replace("#", "") + "&ext=.png";

    return applyDefaults({
        url: iconUrl,
        size: new google.maps.Size(width, height),
        origin: new google.maps.Point(0, 0),
        anchor: new google.maps.Point(width / 2, height)
    }, opts);
}

function createMarkerData(opts) {
    return applyDefaults({
        icon: createMarkerIconOpts(opts),
        content: "Marker"
    }, opts);
}

/**
 * A free function for creating markers. In addition to the parameters below, you can pass any 
 * option listed in Google's reference:
 * https://developers.google.com/maps/documentation/javascript/reference#MarkerOptions
 * 
 * @param {object} [opts] Options for configuring the marker. 
 * @param {google.maps.Map} [opts.map=this.map] The map on which to display the marker. 
 * @param {boolean} [opts.visible=false] Make the marker visible initially.
 * @param {object} [opts.icon=this.createMarkerIconOpts(opts)] The marker's icon.
 * @param {function} [opts.fn] A function called when the marker is clicked.
 * @param {string} [opts.content="Marker"] If the marker does not have opts.fn defined, this 
 * determines the content of the infowindow displayed when the marker is clicked.
 */

function createMarker(opts) {
    if (typeof opts.position === "undefined" && typeof opts.latitude !== "undefined" && typeof opts.longitude !== "undefined") {
        opts.position = new google.maps.LatLng(opts.latitude, opts.longitude);
    }

    var marker = new google.maps.Marker(opts);
    if (typeof opts.fn === "undefined") {
        var iw = new google.maps.InfoWindow({
            content: opts.content
        });
        google.maps.event.addListener(marker, "click", function () {
            var now = new Date();
            iw.setZIndex(now.getTime());
            iw.open(opts.map, marker);
        });
    } else {
        google.maps.event.addListener(marker, "click", opts.fn);
    }
    //   setMarkerMeta(marker, opts);
    return marker;
}

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvdWxyaWNoL2Rldi9DbHVzdGVyTWFuYWdlci9zcmMvQ2x1c3Rlck1hbmFnZXIuanMiLCIvVXNlcnMvdWxyaWNoL2Rldi9DbHVzdGVyTWFuYWdlci9zcmMvTGF6eU1hcmtlci5qcyIsIi9Vc2Vycy91bHJpY2gvZGV2L0NsdXN0ZXJNYW5hZ2VyL3NyYy91dGlscy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FDb0NBLFlBQVksQ0FBQzs7OztxQkFFcUUsU0FBUzs7MEJBQ3BFLGNBQWM7Ozs7QUFFckMsTUFBTSxDQUFDLGNBQWMsR0FBRyxjQUFjLElBQUksRUFBRSxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQTRCN0MsU0FBUyxjQUFjLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRTtBQUMvQixRQUFJLEVBQUUsR0FBRyxJQUFJLENBQUM7QUFDZCxRQUFJLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUNsQixRQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztBQUNmLFFBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDakIsUUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN4QixRQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDNUQsVUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLEdBQUcsRUFBRSxXQUFXLEVBQUUsWUFBVztBQUMxRCxVQUFFLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQztLQUN6QixDQUFDLENBQUM7QUFDSCxVQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsR0FBRyxFQUFFLFNBQVMsRUFBRSxZQUFXO0FBQ3hELFVBQUUsQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDO0FBQ3ZCLFVBQUUsQ0FBQyxhQUFhLEVBQUUsQ0FBQztLQUN0QixDQUFDLENBQUM7QUFDSCxVQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsR0FBRyxFQUFFLGdCQUFnQixFQUFFLFlBQVc7QUFDL0QsWUFBSSxDQUFDLEVBQUUsQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDLGFBQWEsRUFBRSxDQUFDO0tBQzNDLENBQUMsQ0FBQztBQUNILFVBQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxHQUFHLEVBQUUsY0FBYyxFQUFFLFlBQVc7QUFDN0QsVUFBRSxDQUFDLGFBQWEsRUFBRSxDQUFDO0tBQ3RCLENBQUMsQ0FBQztBQUNILFFBQUksT0FBTyxJQUFJLENBQUMsT0FBTyxLQUFLLFdBQVcsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztDQUMxRTs7QUFFRCxjQUFjLENBQUMsU0FBUyxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQzs7Ozs7O0FBTXpELGNBQWMsQ0FBQyxTQUFTLENBQUMsS0FBSyxHQUFHLFlBQVc7QUFDeEMsUUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUM7QUFDbkIsVUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztDQUM3QyxDQUFDOzs7OztBQUtGLGNBQWMsQ0FBQyxTQUFTLENBQUMsSUFBSSxHQUFHLFlBQVcsRUFBRSxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBc0I5QyxjQUFjLENBQUMsU0FBUyxDQUFDLFlBQVksR0FBRyxVQUFTLElBQUksRUFBRTtBQUNuRCxRQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztBQUNsQixRQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQztBQUNuQixRQUFJLENBQUMsV0FBVyxHQUFHLEVBQUUsQ0FBQztBQUN0QixRQUFJLENBQUMsWUFBWSxHQUFHLEVBQUUsQ0FBQztBQUN2QixRQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsU0FBUyxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsU0FBUyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxHQUFDLENBQUMsQ0FBQztBQUMvRSxRQUFJLEdBQUcsV0FoR0gsYUFBYSxFQWdHSTtBQUNqQixlQUFPLEVBQW1CLEdBQUc7QUFDN0IsaUJBQVMsRUFBaUIsS0FBSztBQUMvQix5QkFBaUIsRUFBUywyQkFBUyxVQUFVLEVBQUU7QUFDM0MsbUJBQU8sVUFBVSxHQUFHLFNBQVMsQ0FBQztTQUNqQztBQUNELDJCQUFtQixFQUFPLElBQUk7QUFDOUIsK0JBQXVCLEVBQUcsT0FBTztBQUNqQyxrQkFBVSxFQUFnQixRQUFRO0tBQ3JDLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDVCxRQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztDQUNwQixDQUFDOzs7Ozs7Ozs7OztBQVdGLGNBQWMsQ0FBQyxTQUFTLENBQUMsWUFBWSxHQUFHLFVBQVMsU0FBUyxFQUFFO0FBQ3hELFFBQUcsU0FBUyxJQUFJLEVBQUUsSUFBSSxTQUFTLEdBQUcsQ0FBQyxFQUFFLE9BQU87QUFDNUMsUUFBSSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQztBQUNwQyxRQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDYixRQUFJLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxXQUFXLEVBQUU7QUFDakQsWUFBSSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO0FBQ2hDLGFBQUksSUFBSSxDQUFDLEdBQUMsQ0FBQyxFQUFFLE1BQU0sR0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7QUFDL0MsZ0JBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN4QixnQkFBSSxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sS0FBSyxTQUFTLEVBQUU7QUFDbEQsb0JBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDO2FBQ3pFO1NBQ0o7S0FDSjtBQUNELFFBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztBQUNmLFFBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztDQUN4QixDQUFDOzs7Ozs7O0FBT0YsY0FBYyxDQUFDLFNBQVMsQ0FBQyxZQUFZLEdBQUcsWUFBVztBQUMvQyxXQUFPLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztDQUNsQyxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBbUVGLGNBQWMsQ0FBQyxTQUFTLENBQUMsVUFBVSxHQUFHLFVBQVMsR0FBRyxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUU7QUFDaEUsT0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLEVBQUksQ0FBQyxDQUFDO0FBQzFCLE9BQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUksQ0FBQyxDQUFDO0FBQzNCLE9BQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFDLEdBQUssQ0FBQSxHQUFFLEdBQUssQ0FBQyxHQUFHLEdBQUssQ0FBQzs7QUFFMUMsUUFBSSxTQUFTLElBQUksQ0FBQyxFQUFFLE9BQU8sRUFBRSxDQUFDO0FBQzlCLFFBQUksU0FBUyxHQUFHLEVBQUUsQ0FBQzs7O0FBR25CLFFBQUksT0FBTyxHQUFHLFFBQVEsQ0FBQyxDQUFDLEdBQUcsR0FBRyxFQUFJLENBQUEsR0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxTQUFTLENBQUMsQUFBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzdFLFFBQUksT0FBTyxHQUFHLFFBQVEsQ0FBQyxDQUFDLEdBQUcsR0FBRyxHQUFLLENBQUEsR0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxTQUFTLENBQUMsQUFBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDOztBQUU5RSxRQUFJLGNBQWMsR0FBRyxtREFBbUQsQ0FBQztBQUN6RSxRQUFJLE9BQU8sR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxFQUFFLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLE9BQU8sQ0FBQztBQUN0RSxRQUFJLE9BQU8sR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxFQUFFLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLE9BQU8sQ0FBQzs7O0FBR3RFLFFBQUksT0FBTyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0FBQzFFLFdBQU8sT0FBTyxDQUFDO0NBQ2xCLENBQUM7Ozs7Ozs7O0FBUUYsY0FBYyxDQUFDLFNBQVMsQ0FBQyxzQkFBc0IsR0FBRyxVQUFTLE9BQU8sRUFBRTtBQUNoRSxRQUFJLFNBQVMsR0FBRyxFQUFFLENBQUM7QUFDbkIsUUFBSSxTQUFTLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQ2xELFFBQUksY0FBYyxHQUFHLG1EQUFtRCxDQUFDO0FBQ3pFLFFBQUksYUFBYSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxHQUFHLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEVBQUUsR0FBRyxTQUFTLENBQUMsQ0FBQztBQUM1RixRQUFJLGFBQWEsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQ3pDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEVBQUUsR0FBRyxTQUFTLENBQUMsQ0FBQztBQUM3RCxRQUFJLGFBQWEsR0FBRyxtREFBbUQsQ0FBQztBQUN4RSxRQUFJLGFBQWEsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxFQUFFLEdBQUcsU0FBUyxDQUFDLENBQUM7QUFDM0YsUUFBSSxhQUFhLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUN6QyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxFQUFFLEdBQUcsU0FBUyxDQUFDLENBQUM7QUFDNUQsUUFBSSxhQUFhLEdBQUcsUUFBUSxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUMvQyxRQUFJLGFBQWEsR0FBRyxRQUFRLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQy9DLFFBQUksYUFBYSxHQUFHLFFBQVEsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDL0MsUUFBSSxhQUFhLEdBQUcsUUFBUSxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUMvQyxRQUFJLE1BQU0sR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBSSxFQUFHLEFBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBQyxHQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQzlFLFFBQUksTUFBTSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFLLEVBQUUsQUFBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsU0FBUyxDQUFDLEdBQUksR0FBRyxDQUFDLENBQUM7QUFDL0UsUUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFJLEVBQUksQUFBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsU0FBUyxDQUFDLEdBQUksRUFBRSxDQUFDLENBQUM7QUFDOUUsUUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFLLEVBQUcsQUFBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsU0FBUyxDQUFDLEdBQUksR0FBRyxDQUFDLENBQUM7QUFDL0UsV0FBTyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxFQUN0QyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO0NBQy9FLENBQUM7Ozs7Ozs7OztBQVNGLGNBQWMsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEdBQUcsVUFBUyxPQUFPLEVBQUU7QUFDN0QsUUFBSSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7QUFDbkMsUUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssU0FBUyxJQUFJLFNBQVMsR0FBRyxDQUFDLElBQUksU0FBUyxJQUFJLEVBQUUsRUFBRSxPQUFPLFNBQVMsQ0FBQztBQUM1RixXQUFPLFNBQVMsQ0FBQztDQUNwQixDQUFDOzs7Ozs7Ozs7OztBQVdGLGNBQWMsQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLEdBQUcsVUFBUyxPQUFPLEVBQUUsSUFBSSxFQUFFO0FBQ2hFLFFBQUksTUFBTSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNsRCxRQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbEQsUUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsTUFBTSxFQUNwQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0FBQ2xGLFFBQUksVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLE1BQU0sRUFDcEMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLE1BQU0sRUFBRSxTQUFTLENBQUMsQ0FBQztBQUNsRixRQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxNQUFNLEVBQ3BDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUM7QUFDbEYsUUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsTUFBTSxFQUNwQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0FBQ2xGLFFBQUksVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLE1BQU0sRUFDcEMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLE1BQU0sRUFBRSxTQUFTLENBQUMsQ0FBQztBQUNsRixRQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxNQUFNLEVBQ3BDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUM7QUFDbEYsUUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLFVB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QUssV0FBVyxFQUFFO0FBQ3ZDLFlBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztLQUN6RTs7QUFFRCxRQUFJLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQzFDLFFBQUksT0FBTyxJQUFJLENBQUMsRUFBRSxLQUFLLFdBQVcsRUFBRTtBQUNoQyxZQUFJLEVBQUUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO0FBQ2hDLG1CQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87U0FDeEIsQ0FBQyxDQUFDO0FBQ0gsY0FBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsWUFBVztBQUN0RCxnQkFBSSxHQUFHLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUNyQixjQUFFLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO0FBQzVCLGNBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQztTQUM3QixDQUFDLENBQUM7S0FDTixNQUFNO0FBQ0gsY0FBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0tBQzNEOztBQUVELFdBQU8sTUFBTSxDQUFDO0NBQ2pCIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qKioqXG4qIG1hbGxvY3MgbWVkaWEgaW5kdXN0cmllc1xuKiBodHRwOi8vd3d3Lm1hbGxvY3MubmV0XG4qKioqLyAgXG5cblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICogQ2x1c3RlciBNYW5hZ2VyXG4gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4vKipcbiAqIEBuYW1lIENsdXN0ZXJNYW5hZ2VyXG4gKiBAdmVyc2lvbiAyLjBcbiAqIEBhdXRob3IgTWFyY3VzIFVscmljaFxuICogQGZpbGVvdmVydmlld1xuICogVGhpcyBsaWJyYXJ5IGNyZWF0ZXMgYW5kIG1hbmFnZXMgY2x1c3RlcnMgZm9yIEdvb2dsZSBNYXBzIEFQSSB2My4gSXQgZG9lcyB0d28gdGhpbmdzIHRvIG1ha2UgbWFwcyBcbiAqIHdpdGggbGFyZ2UgbnVtYmVycyBvZiBtYXJrZXJzIG1vcmUgdXNlYWJsZTogMSkgQ29tYmluZXMgbWFya2VycyBpbiBjbG9zZSBwcm94aW1pdHkgdG8gZWFjaCBvdGhlciBcbiAqIGJhc2VkIG9uIHpvb20gbGV2ZWwgaW50byBjbHVzdGVycywgMikgT25seSBhZGRzIG1hcmtlcnMgaW4gdGhlIGN1cnJlbnQgdmlld3BvcnQgKGFuZCBvcHRpb25hbCBcbiAqIHBhZGRpbmcpIHRvIHRoZSBtYXAuXG4gKiA8Yj5Ib3cgaXQgd29ya3M8L2I+Ojxici8+XG4gKiBUaGUgbWFuYWdlciBzZXRzIHVwIGEgZGljdGlvbmFyeSBmb3IgY2x1c3RlcnMgYW5kIGEgZGljdGlvbmFyeSBmb3IgbWFya2Vycy4gRXZlcnkgbWFya2VyIHRoYXQncyBcbiAqIGFkZGVkIHRvIHRoZSBtYW5hZ2VyIGhhcyBhIHN0cmluZyBjcmVhdGVkIGJhc2VkIG9uIGl0J3MgbGF0aXR1ZGUsIGxvbmdpdHVkZSwgYW5kIHpvb20gbGV2ZWwgYW5kIFxuICogdGhhdCdzIHVzZWQgdG8gYWRkIGl0IHRvIHRoZSBjbHVzdGVyIGRpY3Rpb25hcnkuIE5lYXJieSBtYXJrZXJzIHdpbGwgaGFzaCB0byB0aGUgc2FtZSBzdHJpbmcgc28gXG4gKiBub3RoaW5nIGhhcyB0byBiZSBjYWxjdWxhdGVkLiBOZWFyYnkgY2x1c3RlcnMgYXJlIHRoZW4gY29tYmluZWQuXG4gKiBNYXJrZXJzIGNhbiBiZSBhZGRlZCB3aXRoIG9wdGlvbmFsIHR5cGUgYW5kIHN1YnR5cGVzIHNvIHN1YnNldHMgb2YgbWFya2VycyBjYW4gYmUgc2hvd24gYW5kIFxuICogaGlkZGVuLiBNYXJrZXJzIHdpdGggdGhlIHNhbWUgc3VidHlwZSB3aWxsIHN0aWxsIGJlIGNsdXN0ZXJlZCB0b2dldGhlciwgYnV0IGNhbiBiZSBzaG93biBvciBcbiAqIGhpZGRlbiBzZXBlcmF0ZWx5LiBNYXJrZXJzIHdpdGggdGhlIHNhbWUgdHlwZSB3aWxsIGJlIGNsdXN0ZXJlZCB0b2dldGhlciBhbmQgY2FuIGFsc28gYmUgaGlkZGVuXG4gKiBvciBzaG93biBzZXBlcmF0ZWx5LlxuICogVGhlIGZ1bmN0aW9uIHVzZWQgdG8gY3JlYXRlIHRoZSBjbHVzdGVycyBpcyBzdG9yZWQgYW5kIHRoaXMgZnVuY3Rpb24gY2FuIGJlIG92ZXJyaWRkZW4gZm9yIFxuICogZ3JlYXRlciBjb250cm9sIG9mIHRoZSBsb29rIGFuZC9vciBiZWhhdmlvciBvZiB0aGUgY2x1c3RlcnMgZm9yIGVhY2ggbWFya2VyIHR5cGUuXG4gKi9cbiBcbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAqIENsdXN0ZXIgTWFuYWdlclxuICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4ndXNlIHN0cmljdCc7XG5cbmltcG9ydCB7YXBwbHlEZWZhdWx0cywgY3JlYXRlTWFya2VyRGF0YSwgY3JlYXRlTWFya2VySWNvbk9wdHMsIGNyZWF0ZU1hcmtlcn0gZnJvbSBcIi4vdXRpbHNcIjtcbmltcG9ydCBMYXp5TWFya2VyIGZyb20gXCIuL0xhenlNYXJrZXJcIjsgXG5cbndpbmRvdy5DbHVzdGVyTWFuYWdlciA9IENsdXN0ZXJNYW5hZ2VyIHx8IHt9O1xuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgQ2x1c3RlciBNYW5hZ2VyIGZvciBjbHVzdGVyaW5nIG1hcmtlcnMgb24gYSBWMyBHb29nbGUgbWFwLlxuICpcbiAqIEBwYXJhbSB7R01hcDN9IG1hcCBUaGUgbWFwIHRoYXQgdGhlIG1hcmtlcnMgc2hvdWxkIGJlIGFkZGVkIHRvLlxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRzXSBPcHRpb25zIGZvciBjb25maWd1cmluZyB0aGUgYmVoYXZpb3Igb2YgdGhlIGNsdXN0ZXJpbmcuIERlZmF1bHRzIGFyZSBcbiAqIGFwcGxpZWQgaW4gcmVzZXRNYW5hZ2VyLlxuICogQHBhcmFtIHtnb29nbGUubWFwcy5NYXJrZXJbXX0gW29wdHMubWFya2Vyc10gTWFya2VycyB0byBhZGQgdG8gdGhlIG1hbmFnZXIuXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBbb3B0cy56b29tX3RvX3ByZWNpc2lvbj1mdW5jdGlvbih6b29tX2xldmVsKSB7cmV0dXJuIHpvb21fbGV2ZWwgKyBwcmVjaXNpb247fV0gXG4gKiBBIGZ1bmN0aW9uIHRvIHNldCB0aGUgcHJlY2lzaW9uIGZvciBlYWNoIHpvb20gbGV2ZWwuIFxuICogQHBhcmFtIHtudW1iZXJ9IFtvcHRzLnByZWNpc2lvbj0yXSBBIG51bWJlciBiZXR3ZWVuIDAgYW5kIDI3IHRoYXQgc2V0cyBob3cgc21hbGwgdGhlIGNsdXN0ZXIgXG4gKiBib3hlcyB3aWxsIGJlLiBIaWdoZXIgbnVtYmVycyB3aWxsIG1ha2Ugc21hbGxlciBib3hlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfG9iamVjdH0gW29wdHMuaWNvbl9jb2xvcj1cIjAwQ0MwMFwiXSBTZXRzIHRoZSBkZWZhdWx0IGljb24gY29sb3IgaW4gSEVYLiBEZWZhdWx0IGlzIFxuICogYSBicmlnaHQgZ3JlZW4uXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdHMucGFkZGluZz0yMDBdIFRoZSBhbW91bnQgb2YgcGFkZGluZyBpbiBwaXhlbHMgd2hlcmUgbWFya2VycyBub3QgaW4gdGhlIFxuICogdmlld3BvcnQgd2lsbCBzdGlsbCBiZSBhZGRlZCB0byB0aGUgbWFwLlxuICogQHBhcmFtIHtib29sZWFufSBbb3B0cy52aXN1YWxpemU9ZmFsc2VdIEZvciBkZWJ1Z2dpbmcuIFdpbGwgcHV0IGEgYm94IGFyb3VuZCBlYWNoIGNsdXN0ZXIgd2l0aCBhdCBcbiAqIGxlYXN0IG9uZSBtYXJrZXIuXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdHMuY2x1c3Rlcl9ieV9kaXN0YW5jZT10cnVlXSBDb21iaW5lIG5laWdoYm9yaW5nIGNsdXN0ZXJzIGlmIHRoZXkgYXJlIGNsb3NlIFxuICogdG9nZXRoZXIuIFRoaXMgaXMgYSBsaXR0bGUgc2xvd2VyIGJ1dCBtYWtlcyBtb3JlIHJvdW5kZWQgY2x1c3RlcnMuXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdHMuY2x1c3Rlcl9kaXN0YW5jZV9mYWN0b3I9MjA0ODAwMF0gQ2x1c3RlcnMgYXJlIGNvbWJpbmVkIGlmIHRoZXkgYXJlIHdpdGhpbiBcbiAqIHRoaXMgZGlzdGFuY2U6IGNsdXN0ZXJfZGlzdGFuY2VfZmFjdG9yKk1hdGgucG93KDIsIC1wcmVjaXNpb24rMilcbiAqIEBjb25zdHJ1Y3RvclxuICovXG5cblxuICAgICBcbmZ1bmN0aW9uIENsdXN0ZXJNYW5hZ2VyKG1hcCwgb3B0cykge1xuICAgIHZhciBtZSA9IHRoaXM7XG4gICAgb3B0cyA9IG9wdHMgfHwge307XG4gICAgdGhpcy5tYXAgPSBtYXA7XG4gICAgdGhpcy5zZXRNYXAobWFwKTtcbiAgICB0aGlzLnJlc2V0TWFuYWdlcihvcHRzKTtcbiAgICB0aGlzLnNldFByZWNpc2lvbih0aGlzLnpvb21Ub1ByZWNpc2lvbih0aGlzLm1hcC5nZXRab29tKCkpKTtcbiAgICBnb29nbGUubWFwcy5ldmVudC5hZGREb21MaXN0ZW5lcihtYXAsIFwiZHJhZ3N0YXJ0XCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICBtZS5tYXBEcmFnZ2luZyA9IHRydWU7XG4gICAgfSk7XG4gICAgZ29vZ2xlLm1hcHMuZXZlbnQuYWRkRG9tTGlzdGVuZXIobWFwLCBcImRyYWdlbmRcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgIG1lLm1hcERyYWdnaW5nID0gZmFsc2U7XG4gICAgICAgIG1lLl9vbk1hcE1vdmVFbmQoKTtcbiAgICB9KTtcbiAgICBnb29nbGUubWFwcy5ldmVudC5hZGREb21MaXN0ZW5lcihtYXAsIFwiY2VudGVyX2NoYW5nZWRcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICghbWUubWFwRHJhZ2dpbmcpIG1lLl9vbk1hcE1vdmVFbmQoKTtcbiAgICB9KTtcbiAgICBnb29nbGUubWFwcy5ldmVudC5hZGREb21MaXN0ZW5lcihtYXAsIFwiem9vbV9jaGFuZ2VkXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICBtZS5fb25NYXBNb3ZlRW5kKCk7XG4gICAgfSk7XG4gICAgaWYgKHR5cGVvZiBvcHRzLm1hcmtlcnMgIT09IFwidW5kZWZpbmVkXCIpIHRoaXMuYWRkTWFya2VycyhvcHRzLm1hcmtlcnMpO1xufVxuXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUgPSBuZXcgZ29vZ2xlLm1hcHMuT3ZlcmxheVZpZXcoKTtcbi8qKlxuICogQGlnbm9yZVxuICogVGhpcyBpcyBpbXBsZW1lbnRlZCBvbmx5IHNvIHdlIGNhbiB0ZWxsIHdoZW4gdGhlIG1hcCBpcyByZWFkeSBhbmQgdG8gZ2V0IHRoZSBjdXN0b20gb3ZlcmxheSBcbiAqIGZ1bmN0aW9uYWxpdHkuXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5vbkFkZCA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVhZHlfID0gdHJ1ZTtcbiAgICBnb29nbGUubWFwcy5ldmVudC50cmlnZ2VyKHRoaXMsIFwicmVhZHlfXCIpO1xufTtcblxuLyoqXG4gKiBAaWdub3JlXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5kcmF3ID0gZnVuY3Rpb24oKSB7fTtcblxuLyoqXG4gKiBTZXRzIHRoZSBtYXJrZXIgYW5kIGNsdXN0ZXJzIGJhY2sgdG8gdGhlIGluaXRhbCBzdGF0ZS5cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gW29wdHNdIE9wdGlvbnMgZm9yIGNvbmZpZ3VyaW5nIHRoZSBiZWhhdmlvciBvZiB0aGUgY2x1c3RlcmluZy4gRGVmYXVsdHMgYXJlIFxuICogYXBwbGllZCBpbiByZXNldE1hbmFnZXIuXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBbb3B0cy56b29tX3RvX3ByZWNpc2lvbj1mdW5jdGlvbih6b29tX2xldmVsKSB7cmV0dXJuIHpvb21fbGV2ZWwgKyBwcmVjaXNpb247fV0gXG4gKiBBIGZ1bmN0aW9uIHRvIHNldCB0aGUgcHJlY2lzaW9uIGZvciBlYWNoIHpvb20gbGV2ZWwuIFxuICogQHBhcmFtIHtudW1iZXJ9IFtvcHRzLnByZWNpc2lvbj0yXSBBIG51bWJlciBiZXR3ZWVuIDAgYW5kIDI3IHRoYXQgc2V0cyBob3cgc21hbGwgdGhlIGNsdXN0ZXIgXG4gKiBib3hlcyB3aWxsIGJlLiBIaWdoZXIgbnVtYmVycyB3aWxsIG1ha2Ugc21hbGxlciBib3hlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfG9iamVjdH0gW29wdHMuaWNvbl9jb2xvcj1cIjAwQ0MwMFwiXSBTZXRzIHRoZSBkZWZhdWx0IGljb24gY29sb3IgaW4gSEVYLiBEZWZhdWx0IGlzIFxuICogYSBicmlnaHQgZ3JlZW4uXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdHMucGFkZGluZz0yMDBdIFRoZSBhbW91bnQgb2YgcGFkZGluZyBpbiBwaXhlbHMgd2hlcmUgbWFya2VycyBub3QgaW4gdGhlIFxuICogdmlld3BvcnQgd2lsbCBzdGlsbCBiZSBhZGRlZCB0byB0aGUgbWFwLlxuICogQHBhcmFtIHtib29sZWFufSBbb3B0cy52aXN1YWxpemU9ZmFsc2VdIEZvciBkZWJ1Z2dpbmcuIFdpbGwgcHV0IGEgYm94IGFyb3VuZCBlYWNoIGNsdXN0ZXIgd2l0aCBhdCBcbiAqIGxlYXN0IG9uZSBtYXJrZXIuXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdHMuY2x1c3Rlcl9ieV9kaXN0YW5jZT10cnVlXSBDb21iaW5lIG5laWdoYm9yaW5nIGNsdXN0ZXJzIGlmIHRoZXkgYXJlIGNsb3NlIFxuICogdG9nZXRoZXIuIFRoaXMgaXMgYSBsaXR0bGUgc2xvd2VyIGJ1dCBtYWtlcyBtb3JlIHJvdW5kZWQgY2x1c3RlcnMuXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdHMuY2x1c3Rlcl9kaXN0YW5jZV9mYWN0b3I9MjA0ODAwMF0gQ2x1c3RlcnMgYXJlIGNvbWJpbmVkIGlmIHRoZXkgYXJlIHdpdGhpbiBcbiAqIHRoaXMgZGlzdGFuY2U6IGNsdXN0ZXJfZGlzdGFuY2VfZmFjdG9yKk1hdGgucG93KDIsIC1wcmVjaXNpb24rMilcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLnJlc2V0TWFuYWdlciA9IGZ1bmN0aW9uKG9wdHMpIHtcbiAgICB0aGlzLm1hcmtlcnMgPSB7fTsgLy9ob2xkIG1hcmtlcnMgYnkgdHlwZSwgdGhlbiBzdWJ0eXBlLlxuICAgIHRoaXMuY2x1c3RlcnMgPSB7fTsgLy9kZWZpbmUgY2x1c3RlcnMgYnkgcHJlY2lzaW9uLCB0eXBlLCB0aGVuIGdlb2JveC5cbiAgICB0aGlzLmNsdXN0ZXJfZm5zID0ge307IC8vc3RvcmUgY2x1c3RlciBmdW5jdGlvbiBmb3IgYnVpbGRpbmcgdGhlIGNsdXN0ZXIgbWFya2Vycy5cbiAgICB0aGlzLmNsdXN0ZXJfbWV0YSA9IHt9OyAvL21hcmtlciBjb3VudHMsIGV0Y1xuICAgIHZhciBwcmVjaXNpb24gPSBvcHRzLnByZWNpc2lvbiA+PSAwICYmIG9wdHMucHJlY2lzaW9uIDw9IDI3ID8gb3B0cy5wcmVjaXNpb246MjtcbiAgICBvcHRzID0gYXBwbHlEZWZhdWx0cyh7XG4gICAgICAgIHBhZGRpbmcgICAgICAgICAgICAgICAgIDogMjAwLFxuICAgICAgICB2aXN1YWxpemUgICAgICAgICAgICAgICA6IGZhbHNlLFxuICAgICAgICB6b29tX3RvX3ByZWNpc2lvbiAgICAgICA6IGZ1bmN0aW9uKHpvb21fbGV2ZWwpIHtcbiAgICAgICAgICAgIHJldHVybiB6b29tX2xldmVsICsgcHJlY2lzaW9uO1xuICAgICAgICB9LFxuICAgICAgICBjbHVzdGVyX2J5X2Rpc3RhbmNlICAgICA6IHRydWUsXG4gICAgICAgIGNsdXN0ZXJfZGlzdGFuY2VfZmFjdG9yIDogMjA0ODAwMCxcbiAgICAgICAgaWNvbl9jb2xvciAgICAgICAgICAgICAgOiBcIjAwQ0MwMFwiXG4gICAgfSwgb3B0cyk7XG4gICAgdGhpcy5vcHRzID0gb3B0cztcbn07XG5cbi8qKlxuICogU2V0cyB0aGUgY3VycmVudCBsZXZlbCBvZiBwcmVjaXNpb24uXG4gKiBUbyBzcGVlZCB1cCBjbHVzdGVyaW5nIGFuZCByZWR1Y2UgbWVtb3J5LCBvbmx5IHRoZSBjbHVzdGVycyBmb3IgdGhlIGN1cnJlbnQgcHJlY2lzaW9uIGFyZSBcbiAqIGNhbGN1bGF0ZWQgc28gY2hhbmdpbmcgdGhlIHByZWNpc2lvbiBtYXkgdGFrZSBleHRyYSB0aW1lIHRvIGNhbGN1bGF0ZSBjbHVzdGVycyBhdCB0aGUgbmV3IFxuICogcHJlY2lzaW9uLlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSBwcmVjaXNpb24gVGhlIGxldmVsIHRvIHNldCB0aGUgcHJlY2lzaW9uIHRvLiBDdXJyZW50bHksIG11c3QgYmUgZnJvbSAxIHRvIDQ5LlxuICogQHByaXZhdGVcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLnNldFByZWNpc2lvbiA9IGZ1bmN0aW9uKHByZWNpc2lvbikge1xuICAgIGlmKHByZWNpc2lvbiA+PSA1MCB8fCBwcmVjaXNpb24gPCAwKSByZXR1cm47XG4gICAgdGhpcy5jdXJyZW50X3ByZWNpc2lvbl8gPSBwcmVjaXNpb247XG4gICAgdGhpcy5jbGVhcigpO1xuICAgIGlmICh0eXBlb2YgdGhpcy5jbHVzdGVyc1twcmVjaXNpb25dID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHZhciBtYXJrZXJzID0gdGhpcy5nZXRNYXJrZXJzKCk7XG4gICAgICAgIGZvcih2YXIgaT0wLCBsZW5ndGg9bWFya2Vycy5sZW5ndGg7IGk8bGVuZ3RoOyBpKyspIHsgXG4gICAgICAgICAgICB2YXIgbWFya2VyID0gbWFya2Vyc1tpXTtcbiAgICAgICAgICAgIGlmICh0aGlzLmdldE1hcmtlck1ldGEobWFya2VyKS5zdWJ0eXBlICE9PSBcImNsdXN0ZXJcIikge1xuICAgICAgICAgICAgICAgIHRoaXMuYWRkVG9DbHVzdGVyKG1hcmtlciwgdGhpcy5nZXRNYXJrZXJNZXRhKG1hcmtlcikudHlwZSwgcHJlY2lzaW9uKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmNsdXN0ZXIoKTtcbiAgICB0aGlzLnVwZGF0ZU1hcmtlcnMoKTtcbn07XG5cbi8qKlxuICogR2V0cyB0aGUgY3VycmVudCBwcmVjaXNpb24gb2YgdGhlIGNsdXN0ZXJlci5cbiAqXG4gKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgY3VycmVudCBwcmVjaXNpb24uXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5nZXRQcmVjaXNpb24gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5jdXJyZW50X3ByZWNpc2lvbl87XG59O1xuXG4vKipcbiAqIEdldHMgYSBoYXNoIGJhc2VkIG9uIGxhdGl0dWRlLCBsb25naXR1ZGUgYW5kIHByZWNpc2lvbi4gSGlnaGVyIHByZWNpc2lvbnMgYXJlIGdlb2dyYXBoaWNhbGx5IFxuICogc21hbGxlciBhcmVhcy4gXG4gKiBTaW5jZSBkaXN0YW5jZSBiZXR3ZWVuIGRlZ3JlZXMgb2YgbG9uZ2l0dWRlIHZhcmllcyBiYXNlZCBvbiBsYXRpdHVkZTogXG4gKiAgICAgKHBpLzE4MCkqKDYsMzc4LDEzNy4wIG1ldGVycyljb3MoZGVncmVlcyBsYXRpdHVkZSlcbiAqIHRoZSBhcmVhIGNvdmVyZWQgYnkgYSBnaXZlbiBnZW9oYXNoIHByZWNpc2lvbiB3aWxsIGdldCBzbWFsbGVyIGFzIGl0IGFwcHJvYWNoZXMgdGhlIHBvbGVzIFxuICogKGNvcyg5MCBkZWdyZWVzKSA9IDApLiBcbiAqIElmIHlvdSB2aXN1YWxpemUgdGhlIGJveGVzLCBob3dldmVyLCB0aGV5IHdpbGwgbG9vayBsYXJnZXIgYmFzZWQgb24gdGhlIG1hcCBwcm9qZWN0aW9uLlxuICogVGhlIGNoYXJ0IGJlbG93IHNob3dzIHRoZSB3aWR0aCBjb3ZlcmVkIGJ5IGEgZ2l2ZW4gZ2VvaGFzaCBhdCBlYWNoIHByZWNpc2lvbiBsZXZlbCB1c2luZyA0OSBiaXRzLlxuICogcHJlYyB3aWR0aFx0XHR3aWR0aCBvZiBsYXRcbiAqIFx0KGxhdC9sbmcpXHQobWV0ZXJzKVxuICogMlx0MTQwLjczNzQ4OFx0MTU2NjY4MjUuNTM5MjM5MW1cbiAqIDNcdDcwLjM2ODc0NDNcdDc4MzM0MTIuNzY5NjE5NThtXG4gKiA0XHQzNS4xODQzNzIwXHQzOTE2NzA2LjM4NDgwOTczNDNtXG4gKiA1XHQxNy41OTIxODYwXHQxOTU4MzUzLjE5MjQwNDgxMTVtXG4gKiA2XHQ4Ljc5NjA5MzAyXHQ5NzkxNzYuNTk2MjAyMzUwM21cbiAqIDdcdDQuMzk4MDQ2NTFcdDQ4OTU4OC4yOTgxMDExMTk4bVxuICogOFx0Mi4xOTkwMjMyNVx0MjQ0Nzk0LjE0OTA1MDUwMzc3bVxuICogOVx0MS4wOTk1MTE2Mlx0MTIyMzk3LjA3NDUyNTE5NjUxbVxuICogMTBcdDAuNTQ5NzU1ODFcdDYxMTk4LjUzNzI2MjU0Mjg5bVxuICogMTFcdDAuMjc0ODc3OTBcdDMwNTk5LjI2ODYzMTIxNjA3M21cbiAqIDEyXHQwLjEzNzQzODk1XHQxNTI5OS42MzQzMTU1NTQyNW1cbiAqIDEzXHQwLjA2ODcxOTQ3XHQ3NjQ5LjgxNzE1NzcyMDE3Nm1cbiAqIDE0XHQwLjAzNDM1OTczXHQzODI0LjkwODU3ODgwNjMwMTZtXG4gKiAxNVx0MC4wMTcxNzk4Nlx0MTkxMi40NTQyODkzNDYyMDA4bVxuICogMTZcdDAuMDA4NTg5OTNcdDk1Ni4yMjcxNDQ2MTkzMTQzbVxuICogMTdcdDAuMDA0Mjk0OTZcdDQ3OC4xMTM1NzIyNTQyODkwN21cbiAqIDE4XHQwLjAwMjE0NzQ4XHQyMzkuMDU2Nzg2MDcxNzc2NDZtXG4gKiAxOVx0MC4wMDEwNzM3NFx0MTE5LjUyODM5Mjk4MDUyMDE1bVxuICogMjBcdDAuMDAwNTM2ODdcdDU5Ljc2NDE5NjQzMzMxMDA1bVxuICogMjFcdDAuMDAwMjY4NDNcdDI5Ljg4MjA5ODE2Mjg2ODg5M21cbiAqIDIyXHQwLjAwMDEzNDIxXHQxNC45NDEwNDkwMjYwNjYzNjhtXG4gKiAyM1x0MC4wMDAwNjcxMFx0Ny40NzA1MjQ0NTYwODMxNm1cbiAqIDI0XHQwLjAwMDAzMzU1XHQzLjczNTI2MjE3NDI1NTQ0Nm1cbiAqIDI1XHQwLjAwMDAxNjc3XHQxLjg2NzYzMTAzMDE3NzY5OW1cbiAqIDI2XHQwLjAwMDAwODM4XHQwLjkzMzgxNTQ1OTcyMDc3MDZtXG4gKiAyN1x0MC4wMDAwMDQxOVx0MC40NjY5MDc2NzYwNzQyNTE1NG1cbiAqIDI4XHQwLjAwMDAwMjA5XHQwLjIzMzQ1Mzc4NDI1MDk5Mm1cbiAqIDI5XHQwLjAwMDAwMTA0XHQwLjExNjcyNjgzNTE3NTQ3MjAxbVxuICogMzBcdDUuMjQyODdlLTdcdDAuMDU4MzYzMzYyMjE5NjU3MTRtXG4gKiAzMVx0Mi42MjE0MmUtN1x0MC4wMjkxODE2MjI1Nzc4NTk0OG1cbiAqIDMyXHQxLjMxMDcwZS03XHQwLjAxNDU5MDc1NDMzODkwNTc1NW1cbiAqIDMzXHQ2LjU1MzQ5ZS04XHQwLjAwNzI5NTMyMDIxOTQyODg5NW1cbiAqIDM0XHQzLjI3NjY5ZS04XHQwLjAwMzY0NzYwNDc0MTYzNTU3NTVtXG4gKiAzNVx0MS42MzgyOWUtOFx0MC4wMDE4MjM3NDU0MjA3OTM4MDQ4bVxuICogMzZcdDguMTkwOTllLTlcdDAuMDAwOTExODE3MzQyMzE4MDMwMm1cbiAqIDM3XHQ0LjA5NDk5ZS05XHQwLjAwMDQ1NTg1MzMwMzA4MDE0MjltXG4gKiAzOFx0Mi4wNDcwMWUtOVx0MC4wMDAyMjc4NzI4NjU0MDYzMDk5M21cbiAqIDM5XHQxLjAyMzAxZS05XHQwLjAwMDExMzg4MTA2NDYyNDI4MjhtXG4gKiA0MFx0NS4xMDk5M2UtMTBcdDAuMDAwMDU2ODgzNTgyMjg4MTU4NTltXG4gKiA0MVx0Mi41NDk5OWUtMTBcdDAuMDAwMDI4Mzg2NDIzMDY1MjA3MTIzbVxuICogNDJcdDEuMjcwMTZlLTEwXHQwLjAwMDAxNDEzOTQyNTM5ODg0MjAyM21cbiAqIDQzXHQ2LjMwMTA5ZS0xMVx0MC4wMDAwMDcwMTQzNDQ2MjA1NDg4NG1cbiAqIDQ0XHQzLjEwMDgwZS0xMVx0MC4wMDAwMDM0NTE4MDQyMzE0MDIyNDgybVxuICogNDVcdDEuNTAwNjZlLTExXHQwLjAwMDAwMTY3MDUzNDAzNjgyODk1MjVtXG4gKiA0Nlx0Ni45OTE3NGUtMTJcdDcuNzgzMTY5OTQ0MzE2NzExZS03bVxuICogNDdcdDMuMDEyNzBlLTEyXHQzLjM1MzcyMzYzNDU0Mjk3M2UtN21cbiAqIDQ4XHQ5Ljk0NzU5ZS0xM1x0MS4xMDczNjE1Nzc0NDM0MzQzZS03bVxuICogXG4gKiBAcGFyYW0ge251bWJlcn0gbGF0IExhdGl0dWRlLiBWYWx1ZSBpcyBjbGFtcGVkIHRvIHRoZSBuZWFyZXN0IHZhbHVlIGluIFstOTAuMCwgOTAuMF07XG4gKiBAcGFyYW0ge251bWJlcn0gbG5nIExvbmdpdHVkZS4gVmFsdWUgaXMgd3JhcHBlZCB0byBzdGF5IHdpdGhpbiBbLTE4MCwgMTgwKTtcbiAqIEBwYXJhbSB7bnVtYmVyfSBwcmVjaXNpb24gQW4gaW50ZWdlciByZXByZXNlbnRpbmcgdGhlIG51bWJlciBvZiBiaXRzIHRvIHRha2UgZnJvbSB0aGUgXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgIHVudHJ1bmNhdGVkIGxhdGl0dWRlIGFuZCBsb25naXR1ZGUgaGFzaGVzLlxuICogQHJldHVybnMge3N0cmluZ30gZ2VvaGFzaCBBIGJpbmFyeSBoYXNoIHN0cmluZyB3aXRoIGEgbGVuZ3RoIHR3aWNlIHRoZSBwcmVjaXNpb24uXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5nZXRHZW9oYXNoID0gZnVuY3Rpb24obGF0LCBsbmcsIHByZWNpc2lvbikge1xuICAgIGxhdCA9IE1hdGgubWluKGxhdCwgOTAuMCk7XG4gICAgbGF0ID0gTWF0aC5tYXgobGF0LCAtOTAuMCk7XG4gICAgbG5nID0gTWF0aC5hYnMoKGxuZysxODAuMCklMzYwLjApIC0gMTgwLjA7XG5cbiAgICBpZiAocHJlY2lzaW9uIDw9IDApIHJldHVybiBcIlwiO1xuICAgIHZhciBtYXhfcG93ZXIgPSAxMjsgLy9UaGlzIGlzIHRoZSBsaW1pdCBmb3IgbWF4aW11bSByYW5nZSBvZiBkZWNpbWFsIG51bWJlcnMgaW4gamF2YXNjcmlwdC5cbiAgICAvLyBNYWtlIHRoZSBsYXRpdHVkZSBhbmQgbG9uZ2l0dWRlIHBvc2l0aXZlIGFuZCB0aGVuIG11bGl0aXBseSB0aGVtIGJ5IDEwXjEyIHRvIGdldCByaWQgb2ZcbiAgICAvLyBhcyBtYW55IGRlY2ltYWwgcGxhY2VzIGFzIHBvc3NpYmxlLiBUaGVuIGNoYW5nZSB0aGlzIHRvIGJpbmFyeS5cbiAgICB2YXIgbGF0QmFzZSA9IHBhcnNlSW50KChsYXQgKyA5MC4wKSAqIChNYXRoLnBvdygxMCwgbWF4X3Bvd2VyKSkpLnRvU3RyaW5nKDIpO1xuICAgIHZhciBsbmdCYXNlID0gcGFyc2VJbnQoKGxuZyArIDE4MC4wKSAqIChNYXRoLnBvdygxMCwgbWF4X3Bvd2VyKSkpLnRvU3RyaW5nKDIpO1xuICAgIC8vUGFkIHRoZSBmcm9udCB3aXRoIHplcm9zIHRvIG1ha2Ugc3VyZSBsYXRpdHVkZSBhbmQgbG9uZ2l0dWRlIGFyZSA0OSBiaXRzLlxuICAgIHZhciBmb3J0eW5pbmV6ZXJvcyA9IFwiMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMFwiO1xuICAgIHZhciBsYXRIYXNoID0gZm9ydHluaW5lemVyb3Muc3Vic3RyKDAsIDQ5IC0gbGF0QmFzZS5sZW5ndGgpICsgbGF0QmFzZTtcbiAgICB2YXIgbG5nSGFzaCA9IGZvcnR5bmluZXplcm9zLnN1YnN0cigwLCA0OSAtIGxuZ0Jhc2UubGVuZ3RoKSArIGxuZ0Jhc2U7XG4gICAgLy9UYWtlIGJpdHMgZnJvbSB0aGUgZnJvbnQgYmFzZWQgb24gdGhlIHByZWNpc2lvbi4gXG4gICAgLy9Db25jYXRpbmF0ZSB0aGUgbGF0aXR1ZGUgYW5kIGxvbmdpdHVkZSBzdHJpbmdzLlxuICAgIHZhciBnZW9oYXNoID0gbGF0SGFzaC5zdWJzdHIoMCwgcHJlY2lzaW9uKSArIGxuZ0hhc2guc3Vic3RyKDAsIHByZWNpc2lvbik7XG4gICAgcmV0dXJuIGdlb2hhc2g7XG59O1xuXG4vKipcbiAqIEdpdmVuIGEgZ2VvaGFzaCwgdGhpcyByZXR1cm5zIHRoZSBib3VuZHMgb24gaXQncyByYW5nZS4gVGhlIGludmVyc2Ugb2YgZ2V0R2VvaGFzaC5cbiAqIFxuICogQHBhcmFtIHtzdHJpbmd9IGdlb2hhc2ggQSBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBnZW9ib3guXG4gKiBAcmV0dXJucyB7Z29vZ2xlLm1hcHMuTGF0TG5nQm91bmRzfSBUaGUgYm91bmRzIG9uIHRoZSBnZW9ib3guIFxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuZ2VvaGFzaEdldExhdExuZ0JvdW5kcyA9IGZ1bmN0aW9uKGdlb2hhc2gpIHtcbiAgICB2YXIgbWF4X3Bvd2VyID0gMTI7XG4gICAgdmFyIHByZWNpc2lvbiA9IHRoaXMuZ2VvaGFzaEdldFByZWNpc2lvbihnZW9oYXNoKTtcbiAgICB2YXIgZm9ydHluaW5lemVyb3MgPSBcIjAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBcIjtcbiAgICB2YXIgbGF0TWluSGFzaEJpbiA9IGdlb2hhc2guc3Vic3RyKDAsIHByZWNpc2lvbikgKyBmb3J0eW5pbmV6ZXJvcy5zdWJzdHIoMCwgNDkgLSBwcmVjaXNpb24pO1xuICAgIHZhciBsbmdNaW5IYXNoQmluID0gZ2VvaGFzaC5zdWJzdHIocHJlY2lzaW9uLCBnZW9oYXNoLmxlbmd0aCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9ydHluaW5lemVyb3Muc3Vic3RyKDAsIDQ5IC0gcHJlY2lzaW9uKTtcbiAgICB2YXIgZm9ydHluaW5lb25lcyA9IFwiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMVwiO1xuICAgIHZhciBsYXRNYXhIYXNoQmluID0gZ2VvaGFzaC5zdWJzdHIoMCwgcHJlY2lzaW9uKSArIGZvcnR5bmluZW9uZXMuc3Vic3RyKDAsIDQ5IC0gcHJlY2lzaW9uKTtcbiAgICB2YXIgbG5nTWF4SGFzaEJpbiA9IGdlb2hhc2guc3Vic3RyKHByZWNpc2lvbiwgZ2VvaGFzaC5sZW5ndGgpICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcnR5bmluZW9uZXMuc3Vic3RyKDAsIDQ5IC0gcHJlY2lzaW9uKTtcbiAgICB2YXIgbGF0TWluSGFzaERlYyA9IHBhcnNlSW50KGxhdE1pbkhhc2hCaW4sIDIpO1xuICAgIHZhciBsbmdNaW5IYXNoRGVjID0gcGFyc2VJbnQobG5nTWluSGFzaEJpbiwgMik7XG4gICAgdmFyIGxhdE1heEhhc2hEZWMgPSBwYXJzZUludChsYXRNYXhIYXNoQmluLCAyKTtcbiAgICB2YXIgbG5nTWF4SGFzaERlYyA9IHBhcnNlSW50KGxuZ01heEhhc2hCaW4sIDIpO1xuICAgIHZhciBsYXRNaW4gPSBNYXRoLm1heCgtOTAuMCwgIChsYXRNaW5IYXNoRGVjIC8gTWF0aC5wb3coMTAsIG1heF9wb3dlcikpIC0gOTApO1xuICAgIHZhciBsbmdNaW4gPSBNYXRoLm1heCgtMTgwLjAsIChsbmdNaW5IYXNoRGVjIC8gTWF0aC5wb3coMTAsIG1heF9wb3dlcikpIC0gMTgwKTtcbiAgICB2YXIgbGF0TWF4ID0gTWF0aC5taW4oOTAuMCwgICAobGF0TWF4SGFzaERlYyAvIE1hdGgucG93KDEwLCBtYXhfcG93ZXIpKSAtIDkwKTtcbiAgICB2YXIgbG5nTWF4ID0gTWF0aC5taW4oMTgwLjAsICAobG5nTWF4SGFzaERlYyAvIE1hdGgucG93KDEwLCBtYXhfcG93ZXIpKSAtIDE4MCk7XG4gICAgcmV0dXJuIG5ldyBnb29nbGUubWFwcy5MYXRMbmdCb3VuZHMobmV3IGdvb2dsZS5tYXBzLkxhdExuZyhsYXRNaW4sIGxuZ01pbiksIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBnb29nbGUubWFwcy5MYXRMbmcobGF0TWF4LCBsbmdNYXgpKTtcbn07XG5cbi8qKlxuICogRGVyaXZlcyB0aGUgcHJlY2lzaW9uIGZyb20gYSBnZW9oYXNoIHN0cmluZy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gZ2VvaGFzaCBUaGUgZ2VvaGFzaCB0byBmaW5kIHRoZSBwcmVjaXNpb24gb2YuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgZGVyaXZlZCBwcmVjaXNpb24gb2YgdGhlIGdlb2JveC5cbiAqIEBwcml2YXRlXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5nZW9oYXNoR2V0UHJlY2lzaW9uID0gZnVuY3Rpb24oZ2VvaGFzaCkge1xuICAgIHZhciBwcmVjaXNpb24gPSBnZW9oYXNoLmxlbmd0aCAvIDI7XG4gICAgaWYgKHBhcnNlSW50KHByZWNpc2lvbikgIT09IHByZWNpc2lvbiB8fCBwcmVjaXNpb24gPCAwIHx8IHByZWNpc2lvbiA+PSA1MCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gcHJlY2lzaW9uO1xufTtcblxuLyoqXG4gKiBHZXRzIHRoZSBib3hlcyBzdXJyb3VuZGluZyB0aGUgZ2l2ZW4gYm94IGFuZCBvbmx5IHJldHVybnMgYm94ZXMgdGhhdCBoYXZlIGF0IGxlYXN0IG9uZSBtYXJrZXIuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGJveF9zdHIgVGhlIGdlb2JveCB0byBmaW5kIHRoZSBuZWlnaGJvcnMgb2YuXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSBUaGUgdHlwZSBvZiB0aGUgZ2VvYm94IHRvIGZpbmQgdGhlIG5laWdoYm9ycyBvZi5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gVGhlIHN0cmluZ3MgZm9yIHRoZSBnZW9ib3hlcyB3aXRoIGF0IGxlYXN0IG9uZSBtYXJrZXIgbmVpZ2hib3JpbmcgdGhlIGlucHV0IFxuICogZ2VvYm94LlxuICogQHByaXZhdGVcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLmdldE5laWdoYm9yQm94ZXMgPSBmdW5jdGlvbihib3hfc3RyLCB0eXBlKSB7XG4gICAgdmFyIGJvdW5kcyA9IHRoaXMuZ2VvaGFzaEdldExhdExuZ0JvdW5kcyhib3hfc3RyKTtcbiAgICB2YXIgcHJlY2lzaW9uID0gdGhpcy5nZW9oYXNoR2V0UHJlY2lzaW9uKGJveF9zdHIpO1xuICAgIHZhciBib3hTdHJpbmcxID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXRTb3V0aFdlc3QoKS5sYXQoKSArIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldFNvdXRoV2VzdCgpLmxuZygpIC0gMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmcyID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXRTb3V0aFdlc3QoKS5sYXQoKSAtIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldFNvdXRoV2VzdCgpLmxuZygpICsgMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmczID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXROb3J0aEVhc3QoKS5sYXQoKSArIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldE5vcnRoRWFzdCgpLmxuZygpIC0gMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmc0ID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXROb3J0aEVhc3QoKS5sYXQoKSAtIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldE5vcnRoRWFzdCgpLmxuZygpICsgMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmc1ID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXRTb3V0aFdlc3QoKS5sYXQoKSArIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldFNvdXRoV2VzdCgpLmxuZygpICsgMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmc2ID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXRTb3V0aFdlc3QoKS5sYXQoKSAtIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldFNvdXRoV2VzdCgpLmxuZygpIC0gMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmc3ID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXROb3J0aEVhc3QoKS5sYXQoKSArIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldE5vcnRoRWFzdCgpLmxuZygpICsgMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmc4ID0gdGhpcy5nZXRHZW9oYXNoKGJvdW5kcy5nZXROb3J0aEVhc3QoKS5sYXQoKSAtIDAuMDAwMSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm91bmRzLmdldE5vcnRoRWFzdCgpLmxuZygpIC0gMC4wMDAxLCBwcmVjaXNpb24pO1xuICAgIHZhciBib3hTdHJpbmdzID0gW2JveFN0cmluZzEsIGJveFN0cmluZzIsIGJveFN0cmluZzMsIGJveFN0cmluZzQsIGJveFN0cmluZzUsIGJveFN0cmluZzYsIFxuICAgICAgICAgICAgICAgICAgICAgIGJveFN0cmluZzcsIGJveFN0cmluZzhdO1xuICAgIGZvciAodmFyIGkgPSAwLCBuZWlnaGJvcnMgPSBbXSwgYm94U3RyaW5nOyBib3hTdHJpbmcgPSBib3hTdHJpbmdzW2ldOyBpKyspIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmNsdXN0ZXJzW3ByZWNpc2lvbl1bdHlwZV1bYm94U3RyaW5nXSAhPT0gXCJ1bmRlZmluZWRcIiAmJiBib3hTdHJpbmcgIT09IGJveF9zdHIpIHtcbiAgICAgICAgICAgIG5laWdoYm9ycy5wdXNoKGJveFN0cmluZyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG5laWdoYm9ycztcbn07XG5cbi8qKlxuICogR2l2ZW4gYSBnZW9oYXNoLCB0aGlzIHJldHVybnMgYSBwb2x5Z29uIGNvdmVyaW5nIHRoZSBib3gncyBib3VuZHMuIE1vc3RseSBmb3IgZGVidWdnaW5nIHRvIFxuICogdmlzdWFsaXplIGdlb2JveGVzLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBnZW9oYXNoIEEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgZ2VvYm94LlxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRzXSBPcHRpb25zIGZvciB0aGUgYXBwZWFyYW5jZSBvZiB0aGUgcG9seWdvbi5cbiAqIEBwYXJhbSB7R01hcDN9ICBbb3B0cy5tYXA9dGhpcy5tYXBdIFRoZSBtYXAgdG8gYWRkIHRoZSBwb2x5Z29uIHRvLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRzLnN0cm9rZUNvbG9yXSBcbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0cy5zdHJva2VXZWlnaHRdXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdHMuc3Ryb2tlT3BhY2l0eV0gXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdHMuZmlsbENvbG9yXSBcbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0cy5maWxsT3BhY2l0eV0gLlxuICogQHJldHVybnMge2dvb2dsZS5tYXBzLlBvbHlnb259IEEgcG9seWdvbiBjb3ZlcmluZyB0aGUgYm94J3MgYm91bmRzLlxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuYm94VG9Qb2x5Z29uID0gZnVuY3Rpb24oZ2VvaGFzaCwgb3B0cykge1xuICAgIG9wdHMgPSBhcHBseURlZmF1bHRzKHtcbiAgICAgICAgbWFwICAgICAgICAgICA6IHRoaXMubWFwLFxuICAgICAgICBzdHJva2VDb2xvciAgIDogXCIjZjMzZjAwXCIsXG4gICAgICAgIHN0cm9rZVdlaWdodCAgOiA1LFxuICAgICAgICBzdHJva2VPcGFjaXR5IDogMSxcbiAgICAgICAgZmlsbENvbG9yICAgICA6IFwiI2ZmMDAwMFwiLFxuICAgICAgICBmaWxsT3BhY2l0eSAgIDogMC4yXG4gICAgfSwgb3B0cyk7XG4gICAgdmFyIGJvdW5kcyA9IHRoaXMuZ2VvaGFzaEdldExhdExuZ0JvdW5kcyhnZW9oYXNoKTsgIC8vVE9ETzpjaGFuZ2UgYmFjayEhXG4gICAgdmFyIG5lID0gYm91bmRzLmdldE5vcnRoRWFzdCgpO1xuICAgIHZhciBzdyA9IGJvdW5kcy5nZXRTb3V0aFdlc3QoKTtcbiAgICB2YXIgcG9seWdvbiA9IG5ldyBnb29nbGUubWFwcy5Qb2x5Z29uKHtcbiAgICAgICAgcGF0aHMgICAgICAgICA6IG9wdHMucGF0aHMgfHwgW25lLCBuZXcgZ29vZ2xlLm1hcHMuTGF0TG5nKG5lLmxhdCgpLCBzdy5sbmcoKSksIHN3LCBcbiAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgZ29vZ2xlLm1hcHMuTGF0TG5nKHN3LmxhdCgpLCBuZS5sbmcoKSksIG5lXSxcbiAgICAgICAgc3Ryb2tlQ29sb3IgICA6IG9wdHMuc3Ryb2tlQ29sb3IsXG4gICAgICAgIHN0cm9rZVdlaWdodCAgOiBvcHRzLnN0cm9rZVdlaWdodCxcbiAgICAgICAgc3Ryb2tlT3BhY2l0eSA6IG9wdHMuc3Ryb2tlT3BhY2l0eSxcbiAgICAgICAgZmlsbENvbG9yICAgICA6IG9wdHMuZmlsbENvbG9yLFxuICAgICAgICBmaWxsT3BhY2l0eSAgIDogb3B0cy5maWxsT3BhY2l0eSxcbiAgICAgICAgbWFwICAgICAgICAgICA6IG9wdHMubWFwXG4gICAgfSk7XG4gICAgcmV0dXJuIHBvbHlnb247XG59O1xuXG4vKipcbiAqIFRlc3RzIHdoZXRoZXIgYSBnZW9ib3ggdG91Y2hlcyBhIGdpdmVuIGJvdW5kcy4gUGFkZGluZyBleHBhbmRzIHRoZSByYW5nZSBvZiB0aGUgYm91bmRzIGJhc2VkIG9uIFxuICogdmlld3BvcnQgcGl4ZWxzLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBnZW9oYXNoIEEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgZ2VvYm94LlxuICogQHBhcmFtIHtnb29nbGUubWFwcy5MYXRMbmdCb3VuZHN9IGJvdW5kcyBUaGUgYm91bmRzIHRvIGJlIHRlc3RlZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbcGFkZGluZ10gVGhlIG51bWJlciBvZiBwaXhlbHMgdG8gZXhwYW5kIHRoZSBib3VuZHMuIFxuICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgYW55IHBhcnQgb2YgdGhlIGdlb2JveCB0b3VjaGVzIHRoZSBib3VuZHMgZXhwYW5kZWQgYnkgdGhlIHBhZGRpbmcuXG4gKiBAcHJpdmF0ZVxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuYm94SW5Cb3VuZHMgPSBmdW5jdGlvbihnZW9oYXNoLCBib3VuZHMsIHBhZGRpbmcpIHtcbiAgICAvL21ha2UgYSBuZXcgTGF0TG5nQm91bmRzIHNvIHdlIGRvbid0IGhhdmUgYW55IHNpZGUgZWZmZWN0cyBvbiBvdXIgbWFwIGJvdW5kcy5cbiAgICB2YXIgbmV3Qm91bmRzID0gbmV3IGdvb2dsZS5tYXBzLkxhdExuZ0JvdW5kcyh0aGlzLm1hcC5nZXRCb3VuZHMoKS5nZXRTb3V0aFdlc3QoKSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5tYXAuZ2V0Qm91bmRzKCkuZ2V0Tm9ydGhFYXN0KCkpO1xuICAgIGlmICh0eXBlb2YgcGFkZGluZyAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICB2YXIgcHJvaiA9IHRoaXMubWFwLmdldFByb2plY3Rpb24oKTtcbiAgICAgICAgdmFyIHNjYWxlID0gTWF0aC5wb3coMiwgdGhpcy5tYXAuZ2V0Wm9vbSgpKTtcbiAgICAgICAgdmFyIHBpeGVsT2Zmc2V0ID0gbmV3IGdvb2dsZS5tYXBzLlBvaW50KChwYWRkaW5nIC8gc2NhbGUpIHx8IDAsIChwYWRkaW5nIC8gc2NhbGUpIHx8IDApO1xuICAgICAgICB2YXIgbmVQb2ludCA9IHByb2ouZnJvbUxhdExuZ1RvUG9pbnQoYm91bmRzLmdldE5vcnRoRWFzdCgpKTtcbiAgICAgICAgdmFyIHN3UG9pbnQgPSBwcm9qLmZyb21MYXRMbmdUb1BvaW50KGJvdW5kcy5nZXRTb3V0aFdlc3QoKSk7XG4gICAgICAgIHZhciBuZXdORVBvaW50ID0gbmV3IGdvb2dsZS5tYXBzLlBvaW50KG5lUG9pbnQueCArIHBpeGVsT2Zmc2V0LngsIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZVBvaW50LnkgLSBwaXhlbE9mZnNldC55KTtcbiAgICAgICAgdmFyIG5ld1NXUG9pbnQgPSBuZXcgZ29vZ2xlLm1hcHMuUG9pbnQoc3dQb2ludC54IC0gcGl4ZWxPZmZzZXQueCwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN3UG9pbnQueSArIHBpeGVsT2Zmc2V0LnkpO1xuICAgICAgICB2YXIgbmV3TkUgPSBwcm9qLmZyb21Qb2ludFRvTGF0TG5nKG5ld05FUG9pbnQpO1xuICAgICAgICB2YXIgbmV3U1cgPSBwcm9qLmZyb21Qb2ludFRvTGF0TG5nKG5ld1NXUG9pbnQpO1xuICAgICAgICBuZXdCb3VuZHMuZXh0ZW5kKG5ld05FKTtcbiAgICAgICAgbmV3Qm91bmRzLmV4dGVuZChuZXdTVyk7XG4gICAgfVxuICAgIHZhciBib3hCb3VuZHMgPSB0aGlzLmdlb2hhc2hHZXRMYXRMbmdCb3VuZHMoZ2VvaGFzaCk7XG4gICAgaWYgKG5ld0JvdW5kcy5jb250YWlucyhib3hCb3VuZHMuZ2V0Tm9ydGhFYXN0KCkpIHx8IFxuICAgICAgICBuZXdCb3VuZHMuY29udGFpbnMoYm94Qm91bmRzLmdldFNvdXRoV2VzdCgpKSB8fCBcbiAgICAgICAgYm94Qm91bmRzLnRvU3BhbigpLmxhdCgpID09PSAxODApIHJldHVybiB0cnVlO1xuICAgIGVsc2UgcmV0dXJuIGZhbHNlO1xufTtcblxuLyoqXG4gKiBVc2UgdGhpcyB0byBhZGQgbWFya2VycyBpbiBvbmUgYmF0Y2ggdGhyb3VnaCBhbiBhcnJheS5cbiAqXG4gKiBAcGFyYW0ge2dvb2dsZS5tYXBzLk1hcmtlcltdfSBtYXJrZXJzIEFuIGFycmF5IG9mIG1hcmtlcnMuXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSBUaGUgdHlwZSBmb3IgdGhlIG1hcmtlcnMgYmVpbmcgYWRkZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gc3VidHlwZSBUaGUgc3VidHlwZSBmb3IgdGhlIG1hcmtlcnMgYmVpbmcgYWRkZWQuXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5hZGRNYXJrZXJzID0gZnVuY3Rpb24obWFya2VycywgdHlwZSwgc3VidHlwZSkge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwobWFya2VycykgPT09ICdbb2JqZWN0IEFycmF5XScpIHtcblxuICAgICAgICBmb3IodmFyIGk9MCwgbGVuZ3RoPW1hcmtlcnMubGVuZ3RoOyBpPGxlbmd0aDsgaSsrKSB7IFxuICAgICAgICAgICAgdmFyIG1hcmtlciA9IG1hcmtlcnNbaV07XG4gICAgICAgICAgICB0aGlzLmFkZE1hcmtlcihtYXJrZXIsIHtcbiAgICAgICAgICAgICAgICB0eXBlICAgIDogdHlwZSxcbiAgICAgICAgICAgICAgICBzdWJ0eXBlIDogc3VidHlwZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG4vKipcbiAqIEFkZCBhIHNpbmdsZSBtYXJrZXIgdG8gdGhlIG1hcC4gU3RvcmVzIGFuIGFzc29jaWF0aXZlIGFycmF5IGZvciBsb29raW5nIGZvciBtYXJrZXIgdHlwZXMgc28gd2UgXG4gKiBjYW4gY2x1c3RlciBieSB0eXBlLiBEb2Vzbid0IGJ1aWxkIGNsdXN0ZXJzIG9yIGFkZCB0aGVtIHRvIHRoZSBtYXAuIEVhY2ggbWFya2VyIGNhbiBoYXZlIGFuIG9wdCBcbiAqIHR5cGUgYW5kIHN1YnR5cGUgdG8gY2x1c3RlciBieS4gXG4gKlxuICogQHBhcmFtIHtnb29nbGUubWFwcy5NYXJrZXJ9IG1hcmtlciBUaGUgbWFya2VyIHRvIGFkZC4gXG4gKiBAcGFyYW0ge29iamVjdH0gW29wdHNdIE9wdGlvbnMgZm9yIHRoZSBiZWhhdmlvciBvZiB0aGUgbWFya2VyIGluIHRoZSBjbHVzdGVycy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0cy50eXBlXSBBIHN0cmluZyB0aGF0IGlzIHVzZWQgdG8gc29ydCB3aGljaCBtYXJrZXJzIHRvIGNsdXN0ZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdHMuc3VidHlwZV0gQSBzdHJpbmcgdGhhdCBpcyB1c2VkIHRvIHNob3cvaGlkZSBzdWJzZXRzIG9mIG1hcmtlcnMgb2YgYSBnaXZlbiBcbiAqIHR5cGUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRzLmhpZGRlbl0gU2V0IHRydWUgdG8gbWFrZSBhIG1hcmtlciBkaXNhcHBlYXIgZnJvbSB0aGUgbWFwIGV2ZW4gaWYgaXQncyBpbiBcbiAqIHRoZSB2aWV3cG9ydC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdHMudmlzaWJsZV0gU2V0IHRydWUgaWYgdGhlIG1hcmtlciBpcyB2aXNpYmxlIGluIHRoZSB2aWV3cG9ydC4gXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdHMuc3VtbWFyeV0gVGhlIHN1bW1hcnkgdGV4dCB0aGF0IGFwcGVhcnMgaW4gdGhlIGNsdXN0ZXIncyBpbmZvd2luZG93LiBcbiAqIENsaWNraW5nIG9uIHRoZSB0ZXh0IG9wZW5zIHRoZSBtYXJrZXJzIGluZm93aW5kb3cuXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5hZGRNYXJrZXIgPSBmdW5jdGlvbihyYXdfbWFya2VyLCBvcHRzKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzID09PSBcInVuZGVmaW5lZFwiKSBvcHRzID0gdGhpcy5nZXRNYXJrZXJNZXRhKHJhd19tYXJrZXIpO1xuICAgIHZhciBtYXJrZXIgPSBuZXcgTGF6eU1hcmtlcihyYXdfbWFya2VyKTtcbiAgICBcbiAgICAvL1NldCB3aGVuIHRoZSBtYXJrZXIgaXMgdmlzaWJsZSBpbiB0aGUgdmlld3BvcnQgYW5kIG5vdCBoaWRkZW4uXG4gICAgLy9TZXQgd2hlbiB3ZSB3YW50IHRvIGhpZGUgdGhlIG1hcmtlciBldmVuIGlmIGl0J3MgaW4gdGhlIHZpZXdwb3J0LlxuICAgIHZhciBkZWZhdWx0cyA9IHtcbiAgICAgICAgdHlwZSAgICA6IFwiZ2VuZXJpY1wiLFxuICAgICAgICBzdWJ0eXBlIDogXCJnZW5lcmljXCIsXG4gICAgICAgIGhpZGRlbiAgOiB0cnVlLFxuICAgICAgICB2aXNpYmxlIDogZmFsc2VcbiAgICB9O1xuICAgIG9wdHMgPSBhcHBseURlZmF1bHRzKGRlZmF1bHRzLCBvcHRzKTtcbiAgICB2YXIgdHlwZSA9IG9wdHMudHlwZSxcbiAgICAgICAgc3VidHlwZSA9IG9wdHMuc3VidHlwZTtcbiAgICAvL2lmIHRoaXMgaXMgdGhlIGZpcnN0IG1hcmtlciBvZiB0aGUgdHlwZSwgc2F2ZSB0aGUgY2x1c3RlciBmdW5jdGlvbi5cbiAgICBpZiAodHlwZW9mIHRoaXMubWFya2Vyc1t0eXBlXSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICB0aGlzLm1hcmtlcnNbdHlwZV0gPSB7fTtcbiAgICAgICAgdGhpcy5jbHVzdGVyX21ldGFbdHlwZV0gPSB7XG4gICAgICAgICAgICBjb3VudDoge1xuICAgICAgICAgICAgICAgIHRvdGFsICAgOiAwLFxuICAgICAgICAgICAgICAgIHZpc2libGUgOiAwLFxuICAgICAgICAgICAgICAgIGNsdXN0ZXIgOiAwXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5jbHVzdGVyX2Zuc1t0eXBlXSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICB0aGlzLnNldENsdXN0ZXJGbih0eXBlLCB0aGlzLmNyZWF0ZUNsdXN0ZXJNYXJrZXIpO1xuICAgIH1cbiAgICAvL2lmIHRoaXMgaXMgdGhlIGZpcnN0IG1hcmtlciBvZiB0aGUgc3VidHlwZSwgc2V0IHVwIGFuIGVtcHR5IGFycmF5IHRvIHNhdmUgaXQgaW4uXG4gICAgaWYgKHR5cGVvZiB0aGlzLm1hcmtlcnNbdHlwZV1bc3VidHlwZV0gPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgdGhpcy5tYXJrZXJzW3R5cGVdW3N1YnR5cGVdID0gW107XG4gICAgfVxuICAgIHRoaXMubWFya2Vyc1t0eXBlXVtzdWJ0eXBlXS5wdXNoKG1hcmtlcik7XG4gICAgaWYgKHN1YnR5cGUgIT09IFwiY2x1c3RlclwiKSB7XG4gICAgICAgIHRoaXMuY2x1c3Rlcl9tZXRhW3R5cGVdW1wiY291bnRcIl1bXCJ0b3RhbFwiXSArPSAxO1xuICAgICAgICB0aGlzLmFkZFRvQ2x1c3RlcihtYXJrZXIsIHR5cGUsIHRoaXMuZ2V0UHJlY2lzaW9uKCkpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIG9wdHMuc3VtbWFyeSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICB2YXIgY2FwVHlwZSA9IG9wdHMudHlwZS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIG9wdHMudHlwZS5zbGljZSgxKTtcbiAgICAgICAgb3B0cy5zdW1tYXJ5ID0gdHlwZW9mIG1hcmtlci5nZXRUaXRsZSgpID09PSBcInVuZGVmaW5lZFwiID8gY2FwVHlwZSArIFwiIG1hcmtlciBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY291bnQob3B0cy50eXBlLCBcInRvdGFsXCIpIDogbWFya2VyLmdldFRpdGxlKCk7XG4gICAgfVxuICAgIHRoaXMuc2V0TWFya2VyTWV0YShtYXJrZXIsIG9wdHMpO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBudW1iZXIgb2YgbWFya2VycyBvZiBhIHBhcnRpY3VsYXIgdHlwZS5cbiAqXG4gKiBAcGFyYW0ge251bWJlcn0gdHlwZSBUaGUgdHlwZSBvZiBtYXJrZXIgdG8gY291bnQuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSBUaGUgbnVtYmVyIG9mIG1hcmtlcnMgb2YgYSBwYXJ0aWN1bGFyIHR5cGUuXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5jb3VudCA9IGZ1bmN0aW9uKHR5cGUsIGNvdW50X3R5cGUpIHtcbiAgICByZXR1cm4gdGhpcy5jbHVzdGVyX21ldGFbdHlwZV1bXCJjb3VudFwiXVtjb3VudF90eXBlXTtcbn07XG5cbi8qKlxuICogQWRkcyBhIG1hcmtlciB0byBhIGNsdXN0ZXIgb2JqZWN0LiBEb2VzIG5vdCBjcmVhdGUgdGhlIGNsdXN0ZXIgbWFya2Vycy5cbiAqXG4gKiBAcGFyYW0ge2dvb2dsZS5tYXBzLk1hcmtlcn0gbWFya2VyIFRoZSBtYXJrZXIgdG8gYWRkLiBcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIFRoZSB0eXBlIG9mIHRoZSBtYXJrZXIgdG8gYWRkLiBUaGlzIHdpbGwgYmUgdXNlZCB0byBmb3JtIGNsdXN0ZXIgZ3JvdXBzLiBJZiBcbiAqIG5vIHR5cGUgaXMgZ2l2ZW4gaXQgaXMgYXNzaWduZWQgdHlwZSBcImdlbmVyaWNcIi5cbiAqIEBwYXJhbSB7bnVtYmVyfSBwcmVjaXNpb24gVGhlIHByZWNpc2lvbiB0byBjbHVzdGVyIGF0LlxuICogQHBhcmFtIHtzdHJpbmd9IFtnZW9oYXNoXSBGb3JjZSBhIG1hcmtlciBpbnRvIGEgcGFydGljdWxhciBnZW9ib3ggcmF0aGVyIHRoYW4gaXRzIGRlZmF1bHQgb25lLlxuICogQHByaXZhdGVcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLmFkZFRvQ2x1c3RlciA9IGZ1bmN0aW9uKG1hcmtlciwgdHlwZSwgcHJlY2lzaW9uLCBnZW9oYXNoKSB7XG4gICAgdmFyIGNsdXN0ZXJzID0gdGhpcy5jbHVzdGVycztcbiAgICB2YXIgbWFya2VyTEwgPSBtYXJrZXIuZ2V0TGF0TG5nKCk7XG4gICAgdmFyIG1hcmtlckxhdCA9IG1hcmtlckxMLmxhdGl0dWRlO1xuICAgIHZhciBtYXJrZXJMbmcgPSBtYXJrZXJMTC5sb25naXR1ZGU7XG4gICAgaWYgKHR5cGVvZiBjbHVzdGVyc1twcmVjaXNpb25dID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIGNsdXN0ZXJzW3ByZWNpc2lvbl0gPSB7fTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBjbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIGNsdXN0ZXJzW3ByZWNpc2lvbl1bdHlwZV0gPSB7fTtcbiAgICB9XG4gICAgdmFyIGNsdXN0ZXIgPSBjbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdO1xuICAgIGlmICh0eXBlb2YgZ2VvaGFzaCA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICBnZW9oYXNoID0gdGhpcy5nZXRHZW9oYXNoKG1hcmtlckxhdCwgbWFya2VyTG5nLCBwcmVjaXNpb24pO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGNsdXN0ZXJbZ2VvaGFzaF0gIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgY2x1c3RlcltnZW9oYXNoXVtcIm1hcmtlcnNcIl0ucHVzaChtYXJrZXIpO1xuICAgICAgICB2YXIgbGVuZ3RoID0gY2x1c3RlcltnZW9oYXNoXVtcIm1hcmtlcnNcIl0ubGVuZ3RoO1xuICAgICAgICB2YXIgbGF0ID0gKChsZW5ndGggLSAxKSAvIGxlbmd0aCkgKiBjbHVzdGVyW2dlb2hhc2hdW1wiY2VudGVyXCJdWzBdICsgbWFya2VyTGF0IC8gbGVuZ3RoO1xuICAgICAgICB2YXIgbG5nID0gKChsZW5ndGggLSAxKSAvIGxlbmd0aCkgKiBjbHVzdGVyW2dlb2hhc2hdW1wiY2VudGVyXCJdWzFdICsgbWFya2VyTG5nIC8gbGVuZ3RoO1xuICAgICAgICBjbHVzdGVyW2dlb2hhc2hdW1wiY2VudGVyXCJdID0gW2xhdCwgbG5nXTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBjbHVzdGVyW2dlb2hhc2hdID0ge1xuICAgICAgICAgICAgY2x1c3RlciA6IGZhbHNlLFxuICAgICAgICAgICAgbWFya2VycyA6IFttYXJrZXJdLFxuICAgICAgICAgICAgY2VudGVyICA6IFttYXJrZXJMYXQsIG1hcmtlckxuZ11cbiAgICAgICAgfTtcbiAgICB9XG59O1xuXG4vKipcbiAqIFJlbW92ZXMgYSBtYXJrZXIgZnJvbSBhIGNsdXN0ZXIgYW5kIHJlc2V0cyB0aGUgY2x1c3RlciBib3gncyBwcm9wZXJ0aWVzLlxuICpcbiAqIEBwYXJhbSB7Z29vZ2xlLm1hcHMuTWFya2VyfSBtYXJrZXIgVGhlIG1hcmtlciB0byByZW1vdmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gZ2VvaGFzaCBUaGUgZ2VvaGFzaCB0byByZW1vdmUgdGhlIG1hcmtlciBmcm9tLlxuICogQHByaXZhdGVcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLnJlbW92ZUZyb21DbHVzdGVyID0gZnVuY3Rpb24obWFya2VyLCBnZW9oYXNoKSB7XG4gICAgdmFyIHByZWNpc2lvbiA9IHRoaXMuZ2VvaGFzaEdldFByZWNpc2lvbihnZW9oYXNoKTtcbiAgICB2YXIgdHlwZSA9IHRoaXMuZ2V0TWFya2VyTWV0YShtYXJrZXIpLnR5cGU7XG4gICAgdmFyIGdlb0JveCA9IHRoaXMuY2x1c3RlcnNbcHJlY2lzaW9uXVt0eXBlXVtnZW9oYXNoXTtcbiAgICBpZiAoZ2VvQm94W1wibWFya2Vyc1wiXS5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgZGVsZXRlKHRoaXMuY2x1c3RlcnNbcHJlY2lzaW9uXVt0eXBlXVtnZW9oYXNoXSk7XG4gICAgfSBlbHNlIGlmIChnZW9Cb3hbXCJtYXJrZXJzXCJdLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yICh2YXIgaT0wLCBuZXdfbWFya2Vycz1bXSwgY2VudGVyX2xhdD0wLCBjZW50ZXJfbG5nPTAsIHRlc3RfbWFya2VyOyBcbiAgICAgICAgICAgICB0ZXN0X21hcmtlciA9IGdlb0JveFtcIm1hcmtlcnNcIl1baV07IGkrKykge1xuICAgICAgICAgICAgaWYgKHRlc3RfbWFya2VyICE9PSBtYXJrZXIpIHtcbiAgICAgICAgICAgICAgICBuZXdfbWFya2Vycy5wdXNoKHRlc3RfbWFya2VyKTtcbiAgICAgICAgICAgICAgICBjZW50ZXJfbGF0ID0gY2VudGVyX2xhdCArIHRlc3RfbWFya2VyLmdldExhdExuZygpLmxhdGl0dWRlO1xuICAgICAgICAgICAgICAgIGNlbnRlcl9sbmcgPSBjZW50ZXJfbG5nICsgdGVzdF9tYXJrZXIuZ2V0TGF0TG5nKCkubG9uZ2l0dWRlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNlbnRlcl9sYXQgPSBjZW50ZXJfbGF0IC8gbmV3X21hcmtlcnMubGVuZ3RoO1xuICAgICAgICBjZW50ZXJfbG5nID0gY2VudGVyX2xuZyAvIG5ld19tYXJrZXJzLmxlbmd0aDtcbiAgICAgICAgZ2VvQm94W1wiY2VudGVyXCJdID0gW2NlbnRlcl9sYXQsIGNlbnRlcl9sbmddO1xuICAgICAgICBnZW9Cb3hbXCJtYXJrZXJzXCJdID0gbmV3X21hcmtlcnM7XG4gICAgICAgIGdlb0JveFtcImNsdXN0ZXJcIl0gPSBmYWxzZTtcbiAgICAgICAgdGhpcy5jbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdW2dlb2hhc2hdID0gZ2VvQm94O1xuICAgIH1cbn07XG5cbi8qKlxuICogVGhpcyB0YWtlcyB0d28gZ2VvYm94ZXMgYW5kIHB1dHMgYWxsIHRoZSBtYXJrZXJzIGludG8gdGhlIG9uZSB3aXRoIG1vcmUgbWFya2VycyBvciB0aGUgZmlyc3Qgb25lLlxuICogXG4gKiBAcGFyYW0ge3N0cmluZ30gYm94X3N0cjEgRmlyc3QgYm94IHRvIGNvbWJpbmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYm94X3N0cjIgU2Vjb25kIGJveCB0byBjb21iaW5lLlxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgVHlwZSBvZiB0aGUgYm94ZXMgc2luY2UgdGhpcyBjYW4ndCBiZSBkZXJpdmVkLlxuICogQHByaXZhdGVcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLmNvbWJpbmVCb3hlcyA9IGZ1bmN0aW9uKGJveF9zdHIxLCBib3hfc3RyMiwgdHlwZSkge1xuICAgIHZhciBwcmVjaXNpb24gPSB0aGlzLmdlb2hhc2hHZXRQcmVjaXNpb24oYm94X3N0cjEpO1xuICAgIGlmICh0aGlzLmNsdXN0ZXJzW3ByZWNpc2lvbl1bdHlwZV1bYm94X3N0cjFdW1wibWFya2Vyc1wiXS5sZW5ndGggPCBcbiAgICAgICAgdGhpcy5jbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdW2JveF9zdHIyXVtcIm1hcmtlcnNcIl0ubGVuZ3RoKSB7XG4gICAgICAgIHZhciB0ZW1wID0gYm94X3N0cjE7XG4gICAgICAgIGJveF9zdHIxID0gYm94X3N0cjI7XG4gICAgICAgIGJveF9zdHIyID0gdGVtcDtcbiAgICB9XG4gICAgdmFyIGxlbmd0aCA9IHRoaXMuY2x1c3RlcnNbcHJlY2lzaW9uXVt0eXBlXVtib3hfc3RyMl1bXCJtYXJrZXJzXCJdLmxlbmd0aDtcbiAgICBmb3IgKHZhciBpID0gbGVuZ3RoIC0gMSwgbWFya2VyOyBpID49IDA7IGktLSkge1xuICAgICAgICBtYXJrZXIgPSB0aGlzLmNsdXN0ZXJzW3ByZWNpc2lvbl1bdHlwZV1bYm94X3N0cjJdW1wibWFya2Vyc1wiXVtpXTtcbiAgICAgICAgdGhpcy5yZW1vdmVGcm9tQ2x1c3RlcihtYXJrZXIsIGJveF9zdHIyKTtcbiAgICAgICAgdGhpcy5hZGRUb0NsdXN0ZXIobWFya2VyLCB0eXBlLCBwcmVjaXNpb24sIGJveF9zdHIxKTtcbiAgICB9XG59O1xuXG4vKipcbiAqIFRoaXMgY2hlY2tzIG5laWdoYm9yaW5nIGdlb2JveGVzIHRvIHNlZSBpZiB0aGV5IGFyZSBjZW50ZXJlZCB3aXRoaW4gYSBtaW5pbXVtIGRpc3RhbmNlLiBUaGlzIFxuICogbWFrZXMgdGhlIGNsdXN0ZXJzIGxlc3MgYm94IHNoYXBlZCwgYnV0IGFsc28gdGFrZXMgZXh0cmEgdGltZS5cbiAqIFxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgVGhlIHR5cGUgb2YgdGhlIG1hcmtlcnMgdG8gY2x1c3Rlci5cbiAqIEBwcml2YXRlXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5jb21iaW5lQ2x1c3RlcnNCeURpc3RhbmNlID0gZnVuY3Rpb24odHlwZSkge1xuICAgIHZhciBwcmVjaXNpb24gPSB0aGlzLmdldFByZWNpc2lvbigpO1xuICAgIHZhciBjbHVzdGVycyA9IHRoaXMuY2x1c3RlcnM7XG4gICAgdmFyIGNsdXN0ZXJEaXN0YW5jZUZhY3RvciA9IHRoaXMub3B0cy5jbHVzdGVyX2Rpc3RhbmNlX2ZhY3RvciB8fCAyMDQ4MDAwO1xuICAgIGZvciAodmFyIGJveFN0ciBpbiBjbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdKSB7XG4gICAgICAgIHZhciBuZWlnaGJvcnMgPSB0aGlzLmdldE5laWdoYm9yQm94ZXMoYm94U3RyLCB0eXBlKTtcbiAgICAgICAgdmFyIGRpc3RhbmNlID0gY2x1c3RlckRpc3RhbmNlRmFjdG9yICogTWF0aC5wb3coMiwgLXByZWNpc2lvbiArIDIpO1xuICAgICAgICB2YXIgY2x1c3RlckNlbnRlciA9IGNsdXN0ZXJzW3ByZWNpc2lvbl1bdHlwZV1bYm94U3RyXVtcImNlbnRlclwiXTtcbi8qKipcbiAgICAgICAgbmV3IGdvb2dsZS5tYXBzLkNpcmNsZSh7XG4gICAgICAgICAgICAgICAgc3Ryb2tlQ29sb3IgICA6ICcjRkYwMDAwJyxcbiAgICAgICAgICAgICAgICBzdHJva2VPcGFjaXR5IDogMC44LFxuICAgICAgICAgICAgICAgIHN0cm9rZVdlaWdodCAgOiAyLFxuICAgICAgICAgICAgICAgIGZpbGxDb2xvciAgICAgOiAnI0ZGMDAwMCcsXG4gICAgICAgICAgICAgICAgZmlsbE9wYWNpdHkgICA6IDAuMzUsXG4gICAgICAgICAgICAgICAgbWFwICAgICAgICAgICA6IHRoaXMubWFwLFxuICAgICAgICAgICAgICAgIGNlbnRlciAgICAgICAgOiBuZXcgZ29vZ2xlLm1hcHMuTGF0TG5nKGNsdXN0ZXJDZW50ZXJbMF0sIGNsdXN0ZXJDZW50ZXJbMV0pLFxuICAgICAgICAgICAgICAgIHJhZGl1cyAgICAgICAgOiBkaXN0YW5jZX0pO1xuKioqL1xuICAgICAgICBmb3IgKHZhciBqID0gMCwgcmVzdWx0ID0gMCwgbmVpZ2hib3JTdHI7IG5laWdoYm9yU3RyID0gbmVpZ2hib3JzW2pdOyBqKyspIHtcbiAgICAgICAgICAgIGNsdXN0ZXJDZW50ZXIgPSBjbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdW2JveFN0cl1bXCJjZW50ZXJcIl07XG4gICAgICAgICAgICB2YXIgbmVpZ2hib3JDZW50ZXIgPSBjbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdW25laWdoYm9yU3RyXVtcImNlbnRlclwiXTtcbiAgICAgICAgICAgIHZhciBjdXJyZW50RGlzdCA9IGdvb2dsZS5tYXBzLmdlb21ldHJ5LnNwaGVyaWNhbC5jb21wdXRlRGlzdGFuY2VCZXR3ZWVuKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IGdvb2dsZS5tYXBzLkxhdExuZyhjbHVzdGVyQ2VudGVyWzBdLCBjbHVzdGVyQ2VudGVyWzFdKSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgZ29vZ2xlLm1hcHMuTGF0TG5nKG5laWdoYm9yQ2VudGVyWzBdLCBuZWlnaGJvckNlbnRlclsxXSkpO1xuICAgICAgICAgICAgaWYgKGN1cnJlbnREaXN0IDwgZGlzdGFuY2UpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBqO1xuICAgICAgICAgICAgICAgIGRpc3RhbmNlID0gY3VycmVudERpc3Q7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgbmVpZ2hib3JTdHIgPSBuZWlnaGJvcnNbcmVzdWx0XTtcbiAgICAgICAgICAgIHRoaXMuY29tYmluZUJveGVzKGJveFN0ciwgbmVpZ2hib3JTdHIsIHR5cGUpO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuLyoqXG4gKiBUaGlzIGJ1aWxkcyB0aGUgYWN0dWFsIGNsdXN0ZXIgbWFya2VycyBhbmQgb3B0aW9uYWxseSBjb21iaW5lcyBib3hlcyBpZiB0aGUgbWFya2VycyBnZXQgdG9vIGNsb3NlIFxuICogdG9nZXRoZXIuIEl0IGRvZXMgbm90IHNldCB1cCB0aGUgY2x1c3RlciBkaWN0aW9uYXJ5LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBbdHlwZV0gVGhlIHR5cGUgdG8gY2x1c3Rlci4gSWYgbm9uZSBpcyBnaXZlbiwgdGhpcyBzZXRzIHVwIHRoZSBjbHVzdGVycyBmb3IgZXZlcnkgXG4gKiBncm91cCBpbiB0aGUgY2x1c3RlcmVyLlxuICogQHByaXZhdGVcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLmNsdXN0ZXIgPSBmdW5jdGlvbih0eXBlKSB7XG4gICAgdmFyIHByZWNpc2lvbiA9IHRoaXMuZ2V0UHJlY2lzaW9uKCk7XG4gICAgdmFyIGNsdXN0ZXJzLFxuICAgICAgICBtYXJrZXIsXG4gICAgICAgIGNsdXN0ZXJfbWFya2VycyxcbiAgICAgICAgaTtcbiAgICBpZiAodHlwZW9mIHR5cGUgPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgY2x1c3RlcnMgPSB0aGlzLmNsdXN0ZXJzW3ByZWNpc2lvbl07XG4gICAgICAgIGZvciAodHlwZSBpbiBjbHVzdGVycykge1xuICAgICAgICAgICAgdGhpcy5jbHVzdGVyKHR5cGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1hcmtlcnNbdHlwZV0gPT09IFwidW5kZWZpbmVkXCIpIHJldHVybjsgLy9ubyBtYXJrZXJzIHRvIGNsdXN0ZXJcbiAgICBpZiAodHlwZW9mIHRoaXMubWFya2Vyc1t0eXBlXVtcImNsdXN0ZXJcIl0gIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgZm9yIChpID0gMCwgbWFya2VyOyBtYXJrZXIgPSB0aGlzLm1hcmtlcnNbdHlwZV1bXCJjbHVzdGVyXCJdW2ldOyBpKyspIHtcbiAgICAgICAgICAgIG1hcmtlci5zZXRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICB0aGlzLm1hcmtlcnNbdHlwZV1bXCJjbHVzdGVyXCJdID0gW107XG4gICAgdGhpcy5jbHVzdGVyX21ldGFbdHlwZV1bXCJjb3VudFwiXVtcImNsdXN0ZXJcIl0gPSAwO1xuICAgIGNsdXN0ZXJzID0gdGhpcy5jbHVzdGVycztcbiAgICBpZiAodGhpcy5vcHRzLmNsdXN0ZXJfYnlfZGlzdGFuY2UpIHRoaXMuY29tYmluZUNsdXN0ZXJzQnlEaXN0YW5jZSh0eXBlKTtcbiAgICBmb3IgKHZhciBib3hTdHIgaW4gY2x1c3RlcnNbcHJlY2lzaW9uXVt0eXBlXSkge1xuICAgICAgICAvL3Zpc3VhbGl6ZSB0aGUgYm94ZXMgYnkgYWRkaW5nIHBvbHlnb25zIHRvIHRoZSBtYXAgZm9yIGRlYnVnZ2luZy5cbiAgICAgICAgaWYgKHRoaXMub3B0cy52aXN1YWxpemUpIHRoaXMuYm94VG9Qb2x5Z29uKGJveFN0cikuc2V0TWFwKHRoaXMubWFwKTtcbiAgICAgICAgdmFyIGNsdXN0ZXIgPSBjbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdW2JveFN0cl07XG4gICAgICAgIGZvciAoaSA9IDAsIGNsdXN0ZXJfbWFya2VycyA9IFtdOyBtYXJrZXIgPSBjbHVzdGVyW1wibWFya2Vyc1wiXVtpXTsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgbWV0YSA9IHRoaXMuZ2V0TWFya2VyTWV0YShtYXJrZXIpO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBtZXRhLmhpZGRlbiA9PT0gXCJ1bmRlZmluZWRcIiB8fCAhbWV0YS5oaWRkZW4pIHtcbiAgICAgICAgICAgICAgICBjbHVzdGVyX21hcmtlcnMucHVzaChtYXJrZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChjbHVzdGVyX21hcmtlcnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgY2x1c3RlcltcImNsdXN0ZXJcIl0gPSB0aGlzLmNsdXN0ZXJfZm5zW3R5cGVdKGNsdXN0ZXJfbWFya2VycywgY2x1c3RlcltcImNlbnRlclwiXVswXSwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsdXN0ZXJbXCJjZW50ZXJcIl1bMV0sIHRoaXMpO1xuICAgICAgICAgICAgdGhpcy5hZGRNYXJrZXIoY2x1c3RlcltcImNsdXN0ZXJcIl0sIHtcbiAgICAgICAgICAgICAgICB0eXBlICAgIDogdHlwZSxcbiAgICAgICAgICAgICAgICBzdWJ0eXBlIDogXCJjbHVzdGVyXCIsXG4gICAgICAgICAgICAgICAgaGlkZGVuICA6IGZhbHNlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuY2x1c3Rlcl9tZXRhW3R5cGVdW1wiY291bnRcIl1bXCJjbHVzdGVyXCJdICs9IDE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjbHVzdGVyW1wiY2x1c3RlclwiXSA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxufTtcblxuLyoqXG4gKiBHZXRzIHRoZSBtYXJrZXJzIG9mIGEgZ2l2ZW4gdHlwZSBhbmQvb3Igc3VidHlwZS4gUmV0dXJucyBhbGwgbWFya2VycyBpZiBwYXNzZWQgbm8gcGFyYW1ldGVycy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gW3R5cGVdIFRoZSB0eXBlIG9mIHRoZSBtYXJrZXJzIHRvIHJldHVybi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbc3VidHlwZV0gVGhlIHN1YnR5cGUgb2YgdGhlIG1hcmtlcnMgdG8gcmV0dXJuLlxuICogQHBhcmFtIHtzdHJpbmd8Ym9vbGVhbn0gW3Zpc2libGVdIFBhc3MgXCJhbGxcIiB0byBnZXQgbWFya2VycyB0aGF0IGFyZW4ndCBjbHVzdGVycy5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBQYXNzIHRydWUgdG8gZ2V0IGFsbCBtYXJrZXJzIHRoYXQgYXJlIHZpc2libGUgYW5kIG5vdCBoaWRkZW4uXG4gKiBAcmV0dXJucyB7Z29vZ2xlLm1hcHMuTWFya2VyW119IFRoZSBtYXJrZXJzIG9mIHRoZSBnaXZlbiB0eXBlLlxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuZ2V0TWFya2VycyA9IGZ1bmN0aW9uKHR5cGUsIHN1YnR5cGUsIHZpc2libGUpIHtcbiAgICB2YXIgbWFya2VycyA9IFtdO1xuICAgIGlmICh0aGlzLm1hcmtlcnMgPT09IHt9KSByZXR1cm4gW107IC8vbm8gbWFya2VycyBvZiBhbnkgdHlwZS5cbiAgICBpZiAodHlwZW9mIHR5cGUgPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgZm9yICh0eXBlIGluIHRoaXMubWFya2Vycykge1xuICAgICAgICAgICAgZm9yIChzdWJ0eXBlIGluIHRoaXMubWFya2Vyc1t0eXBlXSkge1xuICAgICAgICAgICAgICAgIG1hcmtlcnMgPSBtYXJrZXJzLmNvbmNhdCh0aGlzLm1hcmtlcnNbdHlwZV1bc3VidHlwZV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygc3VidHlwZSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICBmb3IgKHN1YnR5cGUgaW4gdGhpcy5tYXJrZXJzW3R5cGVdKSB7XG4gICAgICAgICAgICAvL2FjY2VzcyBhbGwgc3ViY2F0ZWdvcmllcyB3aXRoIGEgc3RyaW5nLlxuICAgICAgICAgICAgbWFya2VycyA9IG1hcmtlcnMuY29uY2F0KHRoaXMubWFya2Vyc1t0eXBlXVtzdWJ0eXBlXSk7IFxuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIG1hcmtlcnMgPSB0aGlzLm1hcmtlcnNbdHlwZV1bc3VidHlwZV0gfHwgW107XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgbWFya2VycyA9IFtdO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdmlzaWJsZSA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG1hcmtlcnM7XG5cbiAgICBmb3IgKHZhciBpPTAsIGZpbmFsX21hcmtlcnM9W10sIGxlbmd0aD1tYXJrZXJzLmxlbmd0aDsgaTxsZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgbWFya2VyID0gbWFya2Vyc1tpXTtcbiAgICAgICAgdmFyIG1ldGEgPSB0aGlzLmdldE1hcmtlck1ldGEobWFya2VyKTtcbiAgICAgICAgaWYgKHZpc2libGUgPT09IFwiYWxsXCIgfHwgbWV0YS5oaWRkZW4gIT09IHZpc2libGUgJiYgbWV0YS52aXNpYmxlID09PSB2aXNpYmxlICYmIFxuICAgICAgICAgICAgdHlwZW9mIG1hcmtlciAhPT0gXCJmdW5jdGlvblwiICYmIG1ldGEudHlwZSAhPT0gXCJjbHVzdGVyXCIpIHtcbiAgICAgICAgICAgIGZpbmFsX21hcmtlcnMucHVzaChtYXJrZXIpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmaW5hbF9tYXJrZXJzO1xufTtcblxuLyoqXG4gKiBIYW5kbGVzIGFueSBjaGFuZ2UgaW4gdGhlIG1hcCB2aWV3cG9ydC4gQ2FsbHMgdXBkYXRlTWFya2VycyB3aXRoIGEgdGltZW91dCBzbyBpdCBkb2Vzbid0IGxvY2sgdXAgXG4gKiB0aGUgbWFwLlxuICogQHByaXZhdGVcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLl9vbk1hcE1vdmVFbmQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbWUgPSB0aGlzO1xuICAgIGlmICh0eXBlb2YgbWUubW92ZVRpbWVvdXQgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KG1lLm1vdmVUaW1lb3V0KTtcbiAgICAgICAgZGVsZXRlKG1lLm1vdmVUaW1lb3V0KTtcbiAgICB9XG4gICAgdmFyIHByZWNpc2lvbiA9IG1lLnpvb21Ub1ByZWNpc2lvbihtZS5tYXAuZ2V0Wm9vbSgpKTtcbiAgICBpZiAobWUuZ2V0UHJlY2lzaW9uKCkgIT09IHByZWNpc2lvbikge1xuICAgICAgICBtZS5zZXRQcmVjaXNpb24ocHJlY2lzaW9uKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBtZS5tb3ZlVGltZW91dCA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBkZWxldGUobWUubW92ZVRpbWVvdXQpO1xuICAgICAgICAgICAgbWUudXBkYXRlTWFya2VycygpO1xuICAgICAgICB9LCAxMDApO1xuICAgIH1cbn07XG5cbi8qKlxuICogU2hvd3MgbWFya2VycyBvZiBhbiBpbnB1dCB0eXBlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIFRoZSB0eXBlIG9mIG1hcmtlcnMgdG8gc2hvdy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdWJ0eXBlIFRoZSBzdWJ0eXBlIG9mIG1hcmtlcnMgdG8gc2hvdy5cbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLnNob3cgPSBmdW5jdGlvbih0eXBlLCBzdWJ0eXBlKSB7XG4gICAgdGhpcy5fc2hvd0hpZGUodHlwZSwgc3VidHlwZSwgZmFsc2UpO1xufTtcblxuLyoqXG4gKiBIaWRlcyBtYXJrZXJzIG9mIHRoZSBpbnB1dCB0eXBlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIFRoZSB0eXBlIG9mIG1hcmtlcnMgdG8gaGlkZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdWJ0eXBlIFRoZSBzdWJ0eXBlIG9mIG1hcmtlcnMgdG8gaGlkZS5cbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLmhpZGUgPSBmdW5jdGlvbih0eXBlLCBzdWJ0eXBlKSB7XG4gICAgdGhpcy5fc2hvd0hpZGUodHlwZSwgc3VidHlwZSwgdHJ1ZSk7XG59O1xuXG4vKipcbiAqIERvZXMgdGhlIGFjdHVhbCBzaG93aW5nIG9yIGhpZGluZy5cbiAqIEBwcml2YXRlXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5fc2hvd0hpZGUgPSBmdW5jdGlvbih0eXBlLCBzdWJ0eXBlLCBoaWRlKSB7XG4gICAgdmFyIG1lID0gdGhpcztcbiAgICB2YXIgbWFya2VycyA9IHRoaXMuZ2V0TWFya2Vycyh0eXBlLCBzdWJ0eXBlKTtcbiAgICBmb3IodmFyIGk9MCwgbGVuZ3RoPW1hcmtlcnMubGVuZ3RoOyBpPGxlbmd0aDsgaSsrKSB7IFxuICAgICAgICB2YXIgbWFya2VyID0gbWFya2Vyc1tpXTtcbiAgICAgICAgdGhpcy5nZXRNYXJrZXJNZXRhKG1hcmtlcikuaGlkZGVuID0gaGlkZTtcbiAgICB9XG4gICAgaWYgKHRoaXMucmVhZHlfKSB0aGlzLl9sYWdVcGRhdGUodHlwZSk7XG4gICAgZWxzZSB7XG4gICAgICAgIGdvb2dsZS5tYXBzLmV2ZW50LmFkZExpc3RlbmVyT25jZSh0aGlzLCBcInJlYWR5X1wiLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIG1lLl9sYWdVcGRhdGUodHlwZSk7XG4gICAgICAgIH0pO1xuICAgIH1cbn07XG5cbi8qKlxuICogU2luY2UgY2x1c3RlcmluZyB0YWtlcyB0aW1lLCB0aGlzIHNldHMgdXAgYSBkZWxheSBiZWZvcmUgcmVjbHVzdGVyaW5nLlxuICogXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSBUaGUgdHlwZSB0byB1cGRhdGUuXG4gKiBAcHJpdmF0ZVxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuX2xhZ1VwZGF0ZSA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgICB2YXIgbWUgPSB0aGlzO1xuICAgIGlmICh0eXBlb2YgdGhpcy5wcm9jZXNzaW5nVGltZW91dCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICBjbGVhclRpbWVvdXQobWUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgICAgICBkZWxldGUobWUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgIH1cbiAgICB0aGlzLnByb2Nlc3NpbmdUaW1lb3V0ID0gc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgZGVsZXRlKG1lLnByb2Nlc3NpbmdUaW1lb3V0KTtcbiAgICAgICAgbWUuY2xlYXIodHlwZSk7XG4gICAgICAgIG1lLmNsdXN0ZXIodHlwZSk7XG4gICAgICAgIG1lLnVwZGF0ZU1hcmtlcnMoKTtcbiAgICB9LCAxMDApO1xufTtcblxuLyoqXG4gKiBUaGlzIHNldHMgYSBjbHVzdGVyIHR5cGUgdG8gYW4gZW1wdHkgc3RhdGUuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IFt0eXBlXSBUaGUgdHlwZSB0byByZXNldC4gSWYgbm9uZSBpcyBnaXZlbiwgZXZlcnkgdHlwZSBpbiB0aGUgY2x1c3RlcmVyIGlzIHJlc2V0LlxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gICAgaWYodHlwZW9mIHR5cGUgPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgdmFyIGNsdXN0ZXJzID0gdGhpcy5jbHVzdGVyc1t0aGlzLmdldFByZWNpc2lvbigpXTtcbiAgICAgICAgZm9yKHR5cGUgaW4gY2x1c3RlcnMpIHtcbiAgICAgICAgICAgIHRoaXMucmVzZXQodHlwZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmNsZWFyKHR5cGUpO1xuICAgIC8vdGhpcyBmb3IgbG9vcCBzaG91bGQgcHJvYmFibHkgYmUgYSByZXNldCBjbHVzdGVyIGZ1bmN0aW9uXG4gICAgZm9yKHZhciBwcmVjaXNpb24gaW4gdGhpcy5jbHVzdGVycykge1xuICAgICAgICBkZWxldGUodGhpcy5jbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdKTtcbiAgICAgICAgdGhpcy5jbHVzdGVyc1twcmVjaXNpb25dW3R5cGVdID0ge307XG4gICAgfVxuICAgIGRlbGV0ZSh0aGlzLm1hcmtlcnNbdHlwZV0pO1xuICAgIHRoaXMubWFya2Vyc1t0eXBlXSA9IHt9O1xufTtcblxuLyoqXG4gKiBUaGlzIHJlbW92ZXMgdGhlIG1hcmtlcnMgZnJvbSB0aGUgbWFwLiBVc2UgcmVzZXQgaWYgeW91IHdhbnQgdG8gYWN0dWFsbHkgZ2V0IHJpZCBvZiB0aGUgXG4gKiBtYXJrZXJzLlxuICogIFxuICogQHBhcmFtIHtzdHJpbmd9IFt0eXBlXSBUaGUgdHlwZSB0byBjbGVhci4gSWYgaXQgaXMgbm90IHBhc3NlZCwgYWxsIG1hcmtlcnMgbWFuYWdlZCBieSB0aGUgXG4gKiBjbHVzdGVyZXIgd2lsbCBiZSBjbGVhcmVkLlxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbih0eXBlKSB7XG4gICAgdmFyIG1hcmtlcnMgPSB0aGlzLmdldE1hcmtlcnModHlwZSk7XG4gICAgZm9yKHZhciBpPTAsIGxlbmd0aD1tYXJrZXJzLmxlbmd0aDsgaTxsZW5ndGg7IGkrKykgeyBcbiAgICAgICAgdmFyIG1hcmtlciA9IG1hcmtlcnNbaV07XG4gICAgICAgIG1hcmtlci5zZXRNYXAobnVsbCk7XG4gICAgICAgIHRoaXMuZ2V0TWFya2VyTWV0YShtYXJrZXIpLnZpc2libGUgPSBmYWxzZTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0eXBlICE9PSBcInVuZGVmaW5lZFwiICYmIHRoaXMuY2x1c3Rlcl9tZXRhICYmIHRoaXMuY2x1c3Rlcl9tZXRhW3R5cGVdKSB7XG4gICAgICAgIHRoaXMuY2x1c3Rlcl9tZXRhW3R5cGVdW1wiY291bnRcIl1bXCJ2aXNpYmxlXCJdID0gMDtcbiAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKHZhciBpdGVtIGluIHRoaXMuY2x1c3Rlcl9tZXRhKSB7XG4gICAgICAgICAgICB0aGlzLmNsdXN0ZXJfbWV0YVtpdGVtXVtcImNvdW50XCJdW1widmlzaWJsZVwiXSA9IDA7XG4gICAgICAgIH1cbiAgICB9XG59O1xuXG4vKipcbiAqIENvbnZlcnQgYSBHb29nbGUgbWFwIHpvb20gbGV2ZWwgdG8gYSBjbHVzdGVyZXIgcHJlY2lzaW9uLlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSB6b29tX2xldmVsIFRoZSBHb29nbGUgbWFwJ3Mgem9vbSBsZXZlbFxuICogQHJldHVybnMge251bWJlcn0gVGhlIHByZWNpc2lvbiBvZiB0aGUgaW5wdXQgem9vbSBsZXZlbC4gXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS56b29tVG9QcmVjaXNpb24gPSBmdW5jdGlvbih6b29tX2xldmVsKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0cy56b29tX3RvX3ByZWNpc2lvbih6b29tX2xldmVsKTtcbn07XG5cbi8qKlxuICogVXBkYXRlcyB0aGUgbWFya2VycyBvbiB0aGUgbWFwIGJhc2VkIG9uIHRoZSBjdXJyZW50IHZpZXdwb3J0IHdpdGggcGFkZGluZy5cbiAqIEBwcml2YXRlXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS51cGRhdGVNYXJrZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG1hcmtlcixcbiAgICAgICAgbWV0YSxcbiAgICAgICAgbGVuZ3RoLFxuICAgICAgICBpO1xuICAgIHZhciBwcmVjaXNpb24gPSB0aGlzLmdldFByZWNpc2lvbigpO1xuICAgIHZhciBjdXJyZW50Qm91bmRzID0gdGhpcy5tYXAuZ2V0Qm91bmRzKCk7XG4gICAgdmFyIGNsdXN0ZXIgPSB0aGlzLmNsdXN0ZXJzW3ByZWNpc2lvbl07XG4gICAgZm9yICh2YXIgdHlwZSBpbiBjbHVzdGVyKSB7XG4gICAgICAgIHZhciB0eXBlX2NsdXN0ZXIgPSBjbHVzdGVyW3R5cGVdO1xuICAgICAgICBmb3IgKHZhciBib3ggaW4gdHlwZV9jbHVzdGVyKSB7XG4gICAgICAgICAgICB2YXIgY2x1c3Rlcl9ib3ggPSB0eXBlX2NsdXN0ZXJbYm94XTtcbiAgICAgICAgICAgIHZhciBjbHVzdGVyX2JveF9tZXRhID0gdGhpcy5nZXRNYXJrZXJNZXRhKGNsdXN0ZXJfYm94W1wiY2x1c3RlclwiXSk7XG4gICAgICAgICAgICBpZiAodGhpcy5ib3hJbkJvdW5kcyhib3gsIGN1cnJlbnRCb3VuZHMsIHRoaXMub3B0cy5wYWRkaW5nKSkge1xuICAgICAgICAgICAgICAgIGlmIChjbHVzdGVyX2JveFtcImNsdXN0ZXJcIl0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFjbHVzdGVyX2JveF9tZXRhLmhpZGRlbiAmJiAhY2x1c3Rlcl9ib3hfbWV0YS52aXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IoaT0wLCBsZW5ndGg9Y2x1c3Rlcl9ib3hbXCJtYXJrZXJzXCJdLmxlbmd0aDsgaTxsZW5ndGg7IGkrKykgeyBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZXIgPSBjbHVzdGVyX2JveFtcIm1hcmtlcnNcIl1baV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5nZXRNYXJrZXJNZXRhKG1hcmtlcikudmlzaWJsZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjbHVzdGVyX2JveFtcImNsdXN0ZXJcIl0uc2V0TWFwKHRoaXMubWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsdXN0ZXJfYm94W1wiY2x1c3RlclwiXS5zZXRWaXNpYmxlKHRydWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2x1c3Rlcl9ib3hfbWV0YS52aXNpYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY2x1c3Rlcl9tZXRhW3R5cGVdW1wiY291bnRcIl1bXCJ2aXNpYmxlXCJdICs9IDE7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBtYXJrZXIgPSBjbHVzdGVyX2JveFtcIm1hcmtlcnNcIl1bMF07XG4gICAgICAgICAgICAgICAgICAgIG1ldGEgPSB0aGlzLmdldE1hcmtlck1ldGEobWFya2VyKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFtZXRhLmhpZGRlbiAmJiAhbWV0YS52aXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrZXIuc2V0TWFwKHRoaXMubWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlci5zZXRWaXNpYmxlKHRydWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbWV0YS52aXNpYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY2x1c3Rlcl9tZXRhW3R5cGVdW1wiY291bnRcIl1bXCJ2aXNpYmxlXCJdICs9IDE7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmIChjbHVzdGVyX2JveFtcImNsdXN0ZXJcIl0pIHtcbiAgICAgICAgICAgICAgICAgICAgY2x1c3Rlcl9ib3hbXCJjbHVzdGVyXCJdLnNldFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY2x1c3Rlcl9ib3hfbWV0YS52aXNpYmxlKSB0aGlzLmNsdXN0ZXJfbWV0YVt0eXBlXVtcImNvdW50XCJdW1widmlzaWJsZVwiXSAtPSAxO1xuICAgICAgICAgICAgICAgICAgICBjbHVzdGVyX2JveF9tZXRhLnZpc2libGUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBmb3IoaT0wLCBsZW5ndGg9Y2x1c3Rlcl9ib3hbXCJtYXJrZXJzXCJdLmxlbmd0aDsgaTxsZW5ndGg7IGkrKykgeyBcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlciA9IGNsdXN0ZXJfYm94W1wibWFya2Vyc1wiXVtpXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldGEgPSB0aGlzLmdldE1hcmtlck1ldGEobWFya2VyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtlci5zZXRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtZXRhLnZpc2libGUpIHRoaXMuY2x1c3Rlcl9tZXRhW3R5cGVdW1wiY291bnRcIl1bXCJ2aXNpYmxlXCJdIC09IDE7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZXRhLnZpc2libGUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn07XG5cbi8qKlxuICogU2V0cyB0aGUgY2x1c3RlcmluZyBmdW5jdGlvbiBmb3IgYSBnaXZlbiB0eXBlIG9mIG1hcmtlcnMuIFxuICogXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSBUaGUgdHlwZSB0aGUgY2x1c3RlcmluZyBmdW5jdGlvbiBpcyBzZXQgdXAgZm9yLlxuICogQHBhcmFtIHtmdW5jdGlvbn0gZm4gVGhlIGZ1bmN0aW9uIHRoYXQgaXMgdXNlZCB0byBjbHVzdGVyIHRoZSBtYXJrZXJzLiBTZWVcbiAqICAgICAgICAgICAgICAgICAgICAgIENsdXN0ZXJNYW5hZ2VyLmNyZWF0ZUNsdXN0ZXJNYXJrZXIgZm9yIGFuIGV4YW1wbGUgb2ZcbiAqICAgICAgICAgICAgICAgICAgICAgIGl0cyBwYXJhbWV0ZXJzIGFuZCByZXR1cm4gdmFsdWUuXG4gKi9cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5zZXRDbHVzdGVyRm4gPSBmdW5jdGlvbih0eXBlLCBmbikge1xuICAgIHRoaXMuY2x1c3Rlcl9mbnNbdHlwZV0gPSBmbjtcbn07XG5cbi8qKlxuICogU2V0cyBhIG1hcmtlcidzIG1ldGEgcHJvcGVydGllcy4gUHJvcGVydGllcyBhbHJlYWR5IHNldCBhcmUgdHJlYXRlZCBhcyBkZWZhdWx0cy5cbiAqIFxuICogQHBhcmFtIHtnb29nbGUubWFwcy5NYXJrZXJ9IG1hcmtlclxuICogQHBhcmFtIHtvYmplY3R9IG1ldGFcbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLnNldE1hcmtlck1ldGEgPSBmdW5jdGlvbihtYXJrZXIsIG1ldGEpIHtcbiAgICB2YXIgZGVmYXVsdHMgPSBhcHBseURlZmF1bHRzKG1ldGEsIG1hcmtlci5fY2x1c3Rlcl9tZXRhKTtcbiAgICBtYXJrZXIuX2NsdXN0ZXJfbWV0YSA9IGFwcGx5RGVmYXVsdHMoZGVmYXVsdHMsIG1ldGEpO1xufTtcblxuLyoqXG4gKiBHZXRzIGEgbWFya2VyJ3MgbWV0YSBwcm9wZXJ0aWVzLlxuICogXG4gKiBAcGFyYW0ge2dvb2dsZS5tYXBzLk1hcmtlcn0gbWFya2VyXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBUaGUgb2JqZWN0IHdpdGggZXh0cmEgZGF0YSBhYm91dCB0aGUgbWFya2VyLlxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuZ2V0TWFya2VyTWV0YSA9IGZ1bmN0aW9uKG1hcmtlcikge1xuICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBtYXJrZXIuX2NsdXN0ZXJfbWV0YTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbWFya2VyLl9jbHVzdGVyX21ldGEgPSB7fTtcbiAgICAgICAgcmV0dXJuIG1hcmtlci5fY2x1c3Rlcl9tZXRhO1xuICAgIH1cbn07XG5cbi8qKlxuICogQSBmcmVlIGZ1bmN0aW9uIGZvciBjcmVhdGluZyBjbHVzdGVyIGljb25zLiBBdCBwcmVjaXNpb25zIGdyZWF0ZXIgdGhhbiAxMCwgdGhlIG1hcmtlcnMgd2lsbCBiZVxuICogcHJlY2lzZSBsb29raW5nIHBpbnMuIEF0IHByZWNpc2lvbnMgbGVzcyB0aGVuIDEwLCB0aGUgbWFya2VycyB3aWxsIGJlIGNpcmNsZXMgdGhhdCBmbG9hdCBhYm92ZVxuICogdGhlIG1hcC5cbiAqIFxuICogQHBhcmFtIHtudW1iZXJ9IG51bWJlciBUaGUgbnVtYmVyIG9mIG1hcmtlcnMgaW4gdGhlIGNsdXN0ZXIuXG4gKiBAcGFyYW0ge251bWJlcn0gcHJlY2lzaW9uIFRoZSBwcmVjaXNpb24gb2YgbWFya2Vycy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpY29uX2NvbG9yIEEgSEVYIGNvbG9yIGZvciB0aGUgbWFya2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IFt0ZXh0X2NvbG9yPVwiMDAwMDAwXCJdIEEgSEVYIGNvbG9yIGZvciB0aGUgdGV4dCBpbnNpZGUgdGhlIG1hcmtlcnMuXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgY29uZmlndXJhdGlvbiBvcHRpb25zIGZvciBhIGNsdXN0ZXIgaWNvbi5cbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLmNyZWF0ZUNsdXN0ZXJJY29uID0gZnVuY3Rpb24obnVtYmVyLCBwcmVjaXNpb24sIGljb25fY29sb3IsIHRleHRfY29sb3IpIHtcbiAgICB2YXIgaWNvbk9wdHM7XG4gICAgdGV4dF9jb2xvciA9IHRleHRfY29sb3IgfHwgXCIwMDAwMDBcIjtcbiAgICBpZiAocHJlY2lzaW9uID4gMTApIHtcbiAgICAgICAgaWNvbk9wdHMgPSB7XG4gICAgICAgICAgICBcInVybFwiICA6ICdodHRwOi8vY2hhcnQuYXBpcy5nb29nbGUuY29tL2NoYXJ0P2NodD1kJmNoZHA9bWFwc2FwaSZjaGw9cGluJTI3aVxcXFwlMjdbJyArIFxuICAgICAgICAgICAgICAgICAgICAgIG51bWJlciArICclMjctMiUyN2ZcXFxcaHYlMjdhXFxcXF1oXFxcXF1vXFxcXCcgKyBpY29uX2NvbG9yICsgJyUyN2ZDXFxcXCcgKyB0ZXh0X2NvbG9yICsgXG4gICAgICAgICAgICAgICAgICAgICAgJyUyN3RDXFxcXDAwMDAwMCUyN2VDXFxcXExhdXRvJTI3ZlxcXFwmZXh0PS5wbmcnLFxuICAgICAgICAgICAgXCJzaXplXCIgOiBuZXcgZ29vZ2xlLm1hcHMuU2l6ZSgyMSwgMzQpXG4gICAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHNpemUgPSAoKG51bWJlciArIFwiXCIpLmxlbmd0aCAtIDEpICogNiArIDI0O1xuICAgICAgICBpY29uT3B0cyA9IHtcbiAgICAgICAgICAgIFwic2l6ZVwiICAgOiBuZXcgZ29vZ2xlLm1hcHMuU2l6ZShzaXplLCBzaXplKSxcbiAgICAgICAgICAgIFwiYW5jaG9yXCIgOiBuZXcgZ29vZ2xlLm1hcHMuUG9pbnQoc2l6ZS8yLCBzaXplLzIpLFxuICAgICAgICAgICAgXCJzaGFwZVwiICA6IHtcbiAgICAgICAgICAgICAgICBjb29yZCA6IFtzaXplLzIsIHNpemUvMiwgc2l6ZS8yXSxcbiAgICAgICAgICAgICAgICB0eXBlICA6IFwiY2lyY2xlXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcInVybFwiICAgIDogXCJodHRwOi8vY2hhcnQuYXBpcy5nb29nbGUuY29tL2NoYXJ0P2NodD1pdCZjaHM9XCIgKyBzaXplICsgXCJ4XCIgKyBzaXplICtcbiAgICAgICAgICAgICAgICAgICAgICAgXCImY2hjbz1cIiArIGljb25fY29sb3IgKyBcIiwwMDAwMDBmZixmZmZmZmYwMSZjaGw9XCIgKyBudW1iZXIgKyBcIiZjaHg9XCIgKyBcbiAgICAgICAgICAgICAgICAgICAgICAgIHRleHRfY29sb3IgKyBcIiwwJmNoZj1iZyxzLDAwMDAwMDAwJmV4dD0ucG5nXCJcbiAgICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIGNyZWF0ZU1hcmtlckljb25PcHRzKGljb25PcHRzKTtcbn07XG5cbi8qKlxuICogQSBmcmVlIGZ1bmN0aW9uIGZvciBjcmVhdGluZyBjbHVzdGVyIG1hcmtlcnMuXG4gKiBcbiAqIEBwYXJhbSB7Z29vZ2xlLm1hcHMuTWFya2VyW119IG1hcmtlcl9saXN0IEFuIGFycmF5IG9mIG1hcmtlcnMgdG8gbWFrZSBhIGNsdXN0ZXIgaWNvbiBmb3IuXG4gKiBAcGFyYW0ge251bWJlcn0gY2VudGVyX2xhdCBUaGUgY2VudGVyIGxhdGl0dWRlIG9mIHRoZSBjbHVzdGVyLlxuICogQHBhcmFtIHtudW1iZXJ9IGNlbnRlcl9sbmcgVGhlIGNlbnRlciBsb25naXR1ZGUgb2YgdGhlIGNsdXN0ZXIuXG4gKiBAcGFyYW0ge0NsdXN0ZXJNYW5hZ2VyfSBtYW5hZ2VyIFRoZSBDbHVzdGVyTWFuYWdlciBvYmplY3QgbWFuYWdpbmcgdGhlIGNsdXN0ZXIuXG4gKiBAcmV0dXJucyB7Z29vZ2xlLm1hcHMuTWFya2VyfSBUaGUgbmV3IGNsdXN0ZXIgbWFya2VyLlxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuY3JlYXRlQ2x1c3Rlck1hcmtlciA9IGZ1bmN0aW9uKG1hcmtlcl9saXN0LCBjZW50ZXJfbGF0LCBjZW50ZXJfbG5nLCBtYW5hZ2VyKSB7XG4gICAgdmFyIGh0bWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgaHRtbEVsLnN0eWxlLndpZHRoID0gXCI0MDBweFwiO1xuXG4gICAgZnVuY3Rpb24gbWFya2VyQ2xpY2tDbG9zdXJlKG1hcmtlcikge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgZ29vZ2xlLm1hcHMuZXZlbnQudHJpZ2dlcihtYXJrZXIsIFwiY2xpY2tcIiwgZSk7XG4gICAgICAgIH07XG4gICAgfVxuICAgIGZvciAodmFyIGkgPSAwLCBtYXJrZXI7IG1hcmtlciA9IG1hcmtlcl9saXN0W2ldOyBpKyspIHtcbiAgICAgICAgdmFyIG1hcmtlclNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgbWFya2VyU3Bhbi5pbm5lckhUTUwgPSAnPGI+JyArIG1hbmFnZXIuZ2V0TWFya2VyTWV0YShtYXJrZXIpLnN1bW1hcnkgKyAnPC9iPjxicj4nO1xuICAgICAgICBtYXJrZXJTcGFuLm9uY2xpY2sgPSBtYXJrZXJDbGlja0Nsb3N1cmUobWFya2VyKTtcbiAgICAgICAgbWFya2VyU3Bhbi5zdHlsZS5jb2xvciA9IFwiIzMzNDQ5OVwiO1xuICAgICAgICBtYXJrZXJTcGFuLnN0eWxlLmN1cnNvciA9IFwicG9pbnRlclwiO1xuICAgICAgICBodG1sRWwuYXBwZW5kQ2hpbGQobWFya2VyU3Bhbik7XG4gICAgICAgIGlmIChpID49IDkpIGJyZWFrO1xuICAgIH1cbiAgICBpZiAobWFya2VyX2xpc3QubGVuZ3RoID4gMTApIHtcbiAgICAgICAgaHRtbEVsLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKChtYXJrZXJfbGlzdC5sZW5ndGggLSAxMCkgKyBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiIG1vcmUgbWFya2VycyBpbiB0aGlzIGFyZWEuIFpvb20gaW4gZm9yIGRldGFpbHMuXCIpKTtcbiAgICB9XG4gICAgdmFyIGljb25fY29sb3IgPSBtYW5hZ2VyLm9wdHMuaWNvbl9jb2xvclttYW5hZ2VyLmdldE1hcmtlck1ldGEobWFya2VyX2xpc3RbMF0pLnR5cGVdIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hbmFnZXIub3B0cy5pY29uX2NvbG9yO1xuICAgIHZhciBpY29uID0gbWFuYWdlci5jcmVhdGVDbHVzdGVySWNvbihtYXJrZXJfbGlzdC5sZW5ndGgsIG1hbmFnZXIuZ2V0UHJlY2lzaW9uKCksIGljb25fY29sb3IpO1xuICAgIG1hcmtlciA9IG1hbmFnZXIuY3JlYXRlTWFya2VyKHtcbiAgICAgICAgcG9zaXRpb24gOiBuZXcgZ29vZ2xlLm1hcHMuTGF0TG5nKGNlbnRlcl9sYXQsIGNlbnRlcl9sbmcpLFxuICAgICAgICB0aXRsZSAgICA6IG1hcmtlcl9saXN0Lmxlbmd0aCArIFwiIG1hcmtlcnNcIixcbiAgICAgICAgY29udGVudCAgOiBodG1sRWwsXG4gICAgICAgIHN1bW1hcnkgIDogbWFya2VyX2xpc3QubGVuZ3RoICsgXCIgbWFya2Vyc1wiLFxuICAgICAgICBpY29uICAgICA6IGljb24sXG4gICAgICAgIHNoYXBlICAgIDogaWNvbltcInNoYXBlXCJdLFxuICAgICAgICB6SW5kZXggICA6IG1hcmtlcl9saXN0Lmxlbmd0aFxuICAgIH0pO1xuICAgIHJldHVybiBtYXJrZXI7XG59O1xuXG4vKipcbiAqIEEgZnJlZSBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgbWFya2VyIGljb24gb3B0cy5cbiAqIFxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRzXSBPcHRpb25zIGZvciBjb25maWd1cmluZyB0aGUgYXBwZWFyYW5jZSBvZiB0aGUgbWFya2VyIGljb24uXG4gKiBAcGFyYW0ge251bWJlcn0gW29wdHMud2lkdGg9MzJdIFRoZSB3aWR0aCBvZiB0aGUgaWNvbi5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0cy5oZWlnaHQ9MzJdIFRoZSBoZWlnaHQgb2YgdGhlIGljb24uXG4gKiBAcGFyYW0ge3N0cmluZ3xvYmplY3R9IFtvcHRzLmljb25fY29sb3I9XCJmZjAwMDBcIl0gVGhlIEhFWCBjb2xvciBvZiB0aGUgaWNvbiBvciBhbiBhc3NvY2lhdGUgYXJyYXkgXG4gKiB3aXRoIGEgY29sb3IgZm9yIGNvcnJlc3BvbmRpbmcgbWFya2VyIHR5cGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRzLnR5cGVdIEEgdHlwZSBmb3IgdGhlIG1hcmtlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0cy5zdHJva2VDb2xvcj1cIjAwMDAwMFwiXSBUaGUgSEVYIGNvbG9yIGZvciBpY29uJ3Mgc3Ryb2tlLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRzLmNvcm5lckNvbG9yPVwiZmZmZmZmXCJdIFRoZSBIRVggY29sb3IgZm9yIGljb24ncyBjb3JuZXIuXG4gKiBAcmV0dXJucyB7b2JqZWN0fSBBbiBvYmplY3QgdGhhdCBjYW4gYmUgdXNlZCB0byBjcmVhdGUgYSBtYXAgaWNvbi5cbiAqL1xuQ2x1c3Rlck1hbmFnZXIucHJvdG90eXBlLmNyZWF0ZU1hcmtlckljb25PcHRzID0gZnVuY3Rpb24ob3B0cykge1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gXCJ1bmRlZmluZWRcIikgb3B0cyA9IHt9O1xuICAgIFxuICAgIHZhciBkZWZhdWx0X2ljb25fY29sb3IgPSBcImZmMDAwMFwiO1xuICAgIGlmICh0eXBlb2YgdGhpcy5vcHRzICE9PSBcInVuZGVmaW5lZFwiICYmIHR5cGVvZiB0aGlzLm9wdHMuaWNvbl9jb2xvciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMub3B0cy5pY29uX2NvbG9yID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBkZWZhdWx0X2ljb25fY29sb3IgPSB0aGlzLm9wdHMuaWNvbl9jb2xvcjtcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy5vcHRzLmljb25fY29sb3IgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIG9wdHMudHlwZSAhPT0gXCJ1bmRlZmluZWRcIiAmJiB0eXBlb2YgdGhpcy5vcHRzLmljb25fY29sb3Jbb3B0cy50eXBlXSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgZGVmYXVsdF9pY29uX2NvbG9yID0gdGhpcy5vcHRzLmljb25fY29sb3Jbb3B0cy50eXBlXTtcbiAgICAgICAgfVxuICAgIH0gXG4gICAgb3B0cyA9IGFwcGx5RGVmYXVsdHMoe2ljb25fY29sb3I6IGRlZmF1bHRfaWNvbl9jb2xvcn0sIG9wdHMpO1xuXG4gICAgcmV0dXJuIGNyZWF0ZU1hcmtlckljb25PcHRzKG9wdHMpOyBcbn07XG5cbkNsdXN0ZXJNYW5hZ2VyLnByb3RvdHlwZS5jcmVhdGVNYXJrZXJEYXRhID0gZnVuY3Rpb24ob3B0cykge1xuICAgIHZhciBtYXJrZXJEYXRhID0gY3JlYXRlTWFya2VyRGF0YShhcHBseURlZmF1bHRzKHtpY29uOiB0aGlzLmNyZWF0ZU1hcmtlckljb25PcHRzKG9wdHMpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcDogdGhpcy5tYXB9LCBvcHRzKSk7XG4gICAgdGhpcy5zZXRNYXJrZXJNZXRhKG1hcmtlckRhdGEsIG1hcmtlckRhdGEpOyAvL1RPRE86IG5lZWQgdG8gZ2V0IHJpZCBvZiB0aGlzICAgIFxuXG4gICAgcmV0dXJuIG1hcmtlckRhdGE7XG59O1xuXG4vKipcbiAqIEEgZnJlZSBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgbWFya2Vycy4gSW4gYWRkaXRpb24gdG8gdGhlIHBhcmFtZXRlcnMgYmVsb3csIHlvdSBjYW4gcGFzcyBhbnkgXG4gKiBvcHRpb24gbGlzdGVkIGluIEdvb2dsZSdzIHJlZmVyZW5jZTpcbiAqIGh0dHBzOi8vZGV2ZWxvcGVycy5nb29nbGUuY29tL21hcHMvZG9jdW1lbnRhdGlvbi9qYXZhc2NyaXB0L3JlZmVyZW5jZSNNYXJrZXJPcHRpb25zXG4gKiBcbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0c10gT3B0aW9ucyBmb3IgY29uZmlndXJpbmcgdGhlIG1hcmtlci4gXG4gKiBAcGFyYW0ge2dvb2dsZS5tYXBzLk1hcH0gW29wdHMubWFwPXRoaXMubWFwXSBUaGUgbWFwIG9uIHdoaWNoIHRvIGRpc3BsYXkgdGhlIG1hcmtlci4gXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRzLnZpc2libGU9ZmFsc2VdIE1ha2UgdGhlIG1hcmtlciB2aXNpYmxlIGluaXRpYWxseS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0cy5pY29uPXRoaXMuY3JlYXRlTWFya2VySWNvbk9wdHMob3B0cyldIFRoZSBtYXJrZXIncyBpY29uLlxuICogQHBhcmFtIHtmdW5jdGlvbn0gW29wdHMuZm5dIEEgZnVuY3Rpb24gY2FsbGVkIHdoZW4gdGhlIG1hcmtlciBpcyBjbGlja2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRzLmNvbnRlbnQ9XCJNYXJrZXJcIl0gSWYgdGhlIG1hcmtlciBkb2VzIG5vdCBoYXZlIG9wdHMuZm4gZGVmaW5lZCwgdGhpcyBcbiAqIGRldGVybWluZXMgdGhlIGNvbnRlbnQgb2YgdGhlIGluZm93aW5kb3cgZGlzcGxheWVkIHdoZW4gdGhlIG1hcmtlciBpcyBjbGlja2VkLlxuICovXG5DbHVzdGVyTWFuYWdlci5wcm90b3R5cGUuY3JlYXRlTWFya2VyID0gZnVuY3Rpb24ob3B0cykge1xuICAgIHZhciBtYXJrZXIgPSBjcmVhdGVNYXJrZXIodGhpcy5jcmVhdGVNYXJrZXJEYXRhKG9wdHMpKTtcbiAgICB0aGlzLnNldE1hcmtlck1ldGEobWFya2VyLCBvcHRzKTsgLy9UT0RPOiBuZWVkIHRvIGdldCByaWQgb2YgdGhpcyAgICBcbiAgICByZXR1cm4gbWFya2VyO1xufTtcblxuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5pbXBvcnQge2FwcGx5RGVmYXVsdHMsIGNyZWF0ZU1hcmtlcn0gZnJvbSBcIi4vdXRpbHNcIjtcblxuLy9UT0RPOiBtYWtlIE5vcm1hbGl6ZWRNYXJrZXIgYmFzZSBjbGFzc1xuXG5mdW5jdGlvbiBMYXp5TWFya2VyKHJhd19tYXJrZXIpIHtcbiAgICBpZiAocmF3X21hcmtlci5jb25zdHJ1Y3RvciA9PT0gTGF6eU1hcmtlcikgcmV0dXJuIHJhd19tYXJrZXI7XG4gICAgdGhpcy5yYXdfbWFya2VyID0gcmF3X21hcmtlcjtcbiAgICBcbiAgICBpZiAodHlwZW9mIHJhd19tYXJrZXIuc2V0TWFwID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgdGhpcy5fbWFya2VyID0gcmF3X21hcmtlcjtcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9tYXJrZXIgPSBudWxsO1xuICAgIH1cbiAgICBnb29nbGUubWFwcy5ldmVudC5hZGRMaXN0ZW5lcih0aGlzLCBcImNsaWNrXCIsIGZ1bmN0aW9uIChlKSB7XG4gICAgICAgIC8vbWFya2VyIGhhc24ndCBiZWVuIGFkZGVkIHRvIHRoZSBtYXAgeWV0LCBzbyBub3QgdmlzaWJsZVxuICAgICAgICBpZiAoIXRoaXMuX21hcmtlcikgdGhpcy5fbWFya2VyID0gY3JlYXRlTWFya2VyKGFwcGx5RGVmYXVsdHModGhpcy5yYXdfbWFya2VyLCB7dmlzaWJsZTogZmFsc2V9KSk7XG4gICAgICAgIGdvb2dsZS5tYXBzLmV2ZW50LnRyaWdnZXIodGhpcy5fbWFya2VyLCBcImNsaWNrXCIsIGUpO1xuICAgIH0pO1xufVxuXG5MYXp5TWFya2VyLnByb3RvdHlwZS5zZXRWaXNpYmxlID0gZnVuY3Rpb24odmlzaWJsZSkge1xuICAgIGlmICh0aGlzLl9tYXJrZXIpIHtcbiAgICAgICAgdGhpcy5fbWFya2VyLnNldFZpc2libGUodmlzaWJsZSk7XG4gICAgfVxufTtcblxuTGF6eU1hcmtlci5wcm90b3R5cGUuc2V0TWFwID0gZnVuY3Rpb24gKG1hcCkge1xuICAgIGlmICh0aGlzLl9tYXJrZXIpIHtcbiAgICAgICAgdGhpcy5fbWFya2VyLnNldE1hcChtYXApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghbWFwKSByZXR1cm47XG5cbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIG1hcDogbWFwLFxuICAgICAgICB0aXRsZTogdGhpcy5yYXdfbWFya2VyLnRpdGxlLFxuICAgICAgICBjb250ZW50OiBcIlwiXG4gICAgfTtcblxuICAgIHRoaXMuX21hcmtlciA9IGNyZWF0ZU1hcmtlcihhcHBseURlZmF1bHRzKGRlZmF1bHRzLCB0aGlzLnJhd19tYXJrZXIpKTtcbiAgICB0aGlzLl9tYXJrZXIuc2V0TWFwKG1hcCk7XG59O1xuXG5MYXp5TWFya2VyLnByb3RvdHlwZS5nZXRQb3NpdGlvbiA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAodGhpcy5fbWFya2VyICYmIHRoaXMuX21hcmtlci5nZXRQb3NpdGlvbigpKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9tYXJrZXIuZ2V0UG9zaXRpb24oKTtcbiAgICB9XG4gICAgdmFyIGxhdGxuZyA9IHRoaXMuZ2V0TGF0TG5nKCk7XG4gICAgdGhpcy5yYXdfbWFya2VyLnBvc2l0aW9uID0gbmV3IGdvb2dsZS5tYXBzLkxhdExuZyhsYXRsbmcubGF0aXR1dGRlLCBsYXRsbmcubG9uZ2l0dWRlKTtcbiAgICByZXR1cm4gdGhpcy5yYXdfbWFya2VyLnBvc2l0aW9uO1xufTtcblxuTGF6eU1hcmtlci5wcm90b3R5cGUuZ2V0TGF0TG5nID0gZnVuY3Rpb24gKCkge1xuICAgIGlmICh0aGlzLl9tYXJrZXIgJiYgdHlwZW9mIHRoaXMucmF3X21hcmtlci5sYXRpdHVkZSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICB0aGlzLnJhd19tYXJrZXIucG9zaXRpb24gPSB0aGlzLl9tYXJrZXIuZ2V0UG9zaXRpb24oKTtcbiAgICAgICAgdGhpcy5yYXdfbWFya2VyLmxhdGl0dWRlID0gdGhpcy5yYXdfbWFya2VyLnBvc2l0aW9uLmxhdCgpO1xuICAgICAgICB0aGlzLnJhd19tYXJrZXIubG9uZ2l0dWRlID0gdGhpcy5yYXdfbWFya2VyLnBvc2l0aW9uLmxuZygpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBsYXRpdHVkZTogdGhpcy5yYXdfbWFya2VyLmxhdGl0dWRlLFxuICAgICAgICBsb25naXR1ZGU6IHRoaXMucmF3X21hcmtlci5sb25naXR1ZGVcbiAgICB9O1xufTtcblxuTGF6eU1hcmtlci5wcm90b3R5cGUuZ2V0VGl0bGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuICh0aGlzLl9tYXJrZXIgJiYgdGhpcy5fbWFya2VyLmdldFRpdGxlKCkpIHx8IHRoaXMucmF3X21hcmtlci50aXRsZTtcbn07XG5cbkxhenlNYXJrZXIucHJvdG90eXBlLnNldFZpc2libGUgPSBmdW5jdGlvbiAodmlzaWJsZSkge1xuICAgIHRoaXMuX21hcmtlciAmJiB0aGlzLl9tYXJrZXIuc2V0VmlzaWJsZSh2aXNpYmxlKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IExhenlNYXJrZXI7IiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIFRvb2wgZm9yIGFwcGx5aW5nIGRlZmF1bHRzLiBBbnkgcHJvcGVydHkgaW4gZGVmYXVsdHMgd2lsbCBiZSBvdmVyd3JpdHRlbiBieSBhIGNvcnJlc3BvbmRpbmdcbiAqIHByb3BlcnR5IGluIG9wdHMuIElmIHRoZSBwcm9wZXJ0eSBkb2VzIG5vdCBleGlzdCwgdGhlIGRlZmF1bHQgcmVtYWlucy4gT25seSBwcm9wZXJ0aWVzIGluIFxuICogZGVmYXVsdHMgd2lsbCBiZSBpbmNsdWRlZCBpbiB0aGUgZmluYWwgb2JqZWN0LlxuICogXG4gKiBAcGFyYW0ge29iamVjdH0gW2RlZmF1bHRzXVxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRzXVxuICogQHJldHVybnMge29iamVjdH0gXG4gKi9cbiBleHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0cyhkZWZhdWx0cywgb3B0cykge1xuICAgIGlmICh0eXBlb2YgZGVmYXVsdHMgIT09IFwib2JqZWN0XCIpIHJldHVybiB7fTtcbiAgICBpZiAodHlwZW9mIG9wdHMgIT09IFwib2JqZWN0XCIpIHJldHVybiBkZWZhdWx0cztcbiAgICBmb3IgKHZhciBpbmRleCBpbiBkZWZhdWx0cykge1xuICAgICAgICBpZiAodHlwZW9mIG9wdHNbaW5kZXhdID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICBvcHRzW2luZGV4XSA9IGRlZmF1bHRzW2luZGV4XTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gb3B0cztcbn1cbiBcbi8qKlxuICogQSBmcmVlIGZ1bmN0aW9uIGZvciBjcmVhdGluZyBtYXJrZXIgaWNvbiBvcHRzLlxuICogXG4gKiBAcGFyYW0ge29iamVjdH0gW29wdHNdIE9wdGlvbnMgZm9yIGNvbmZpZ3VyaW5nIHRoZSBhcHBlYXJhbmNlIG9mIHRoZSBtYXJrZXIgaWNvbi5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0cy53aWR0aD0zMl0gVGhlIHdpZHRoIG9mIHRoZSBpY29uLlxuICogQHBhcmFtIHtudW1iZXJ9IFtvcHRzLmhlaWdodD0zMl0gVGhlIGhlaWdodCBvZiB0aGUgaWNvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfG9iamVjdH0gW29wdHMuaWNvbl9jb2xvcj1cImZmMDAwMFwiXSBUaGUgSEVYIGNvbG9yIG9mIHRoZSBpY29uIG9yIGFuIGFzc29jaWF0ZSBhcnJheSBcbiAqIHdpdGggYSBjb2xvciBmb3IgY29ycmVzcG9uZGluZyBtYXJrZXIgdHlwZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdHMudHlwZV0gQSB0eXBlIGZvciB0aGUgbWFya2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRzLnN0cm9rZUNvbG9yPVwiMDAwMDAwXCJdIFRoZSBIRVggY29sb3IgZm9yIGljb24ncyBzdHJva2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gW29wdHMuY29ybmVyQ29sb3I9XCJmZmZmZmZcIl0gVGhlIEhFWCBjb2xvciBmb3IgaWNvbidzIGNvcm5lci5cbiAqIEByZXR1cm5zIHtvYmplY3R9IEFuIG9iamVjdCB0aGF0IGNhbiBiZSB1c2VkIHRvIGNyZWF0ZSBhIG1hcCBpY29uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTWFya2VySWNvbk9wdHMob3B0cykge1xuICAgIGlmICh0eXBlb2Ygb3B0cyA9PT0gXCJ1bmRlZmluZWRcIikgb3B0cyA9IHt9O1xuICAgIGlmICh0eXBlb2Ygb3B0cy53aWR0aCA9PT0gXCJ1bmRlZmluZWRcIikgb3B0cy53aWR0aCA9IDMyO1xuICAgIGlmICh0eXBlb2Ygb3B0cy5oZWlnaHQgPT09IFwidW5kZWZpbmVkXCIpIG9wdHMuaGVpZ2h0ID0gMzI7XG4gICAgdmFyIHdpZHRoID0gb3B0cy53aWR0aCxcbiAgICAgICAgaGVpZ2h0ID0gb3B0cy5oZWlnaHQ7XG4gICAgXG4gICAgdmFyIGljb25fY29sb3IgPSBcImZmMDAwMFwiO1xuICAgIC8vIDEuIG9wdHMuaWNvbl9jb2xvcltvcHRzLnR5cGVdXG4gICAgLy8gMi4gb3B0cy5pY29uX2NvbG9yXG4gICAgLy8gMy4gbWdyIG9wdHMuaWNvbl9jb2xvcltvcHRzLnR5cGVdXG4gICAgLy8gM2EuIG1nciBvcHRzLmljb25fY29sb3Jbb3B0cy50eXBlXSA9PT0gdW5kZWZpbmVkID0+IFwiZmYwMDAwXCJcbiAgICAvLyA0LiBtZ3Igb3B0cy5pY29uX2NvbG9yXG4gICAgLy8gNS4gXCJmZjAwMDBcIlxuICAgIGlmICh0eXBlb2Ygb3B0cy5pY29uX2NvbG9yICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygb3B0cy5pY29uX2NvbG9yID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBpY29uX2NvbG9yID0gb3B0cy5pY29uX2NvbG9yO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBvcHRzLmljb25fY29sb3IgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIG9wdHMudHlwZSAhPT0gXCJ1bmRlZmluZWRcIiAmJiB0eXBlb2Ygb3B0cy5pY29uX2NvbG9yW29wdHMudHlwZV0gPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIGljb25fY29sb3IgPSBvcHRzLmljb25fY29sb3Jbb3B0cy50eXBlXTsgICAgICAgICAgICBcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygb3B0cy5zdHJva2VDb2xvciA9PT0gXCJ1bmRlZmluZWRcIikgb3B0cy5zdHJva2VDb2xvciA9IFwiMDAwMDAwXCI7XG4gICAgaWYgKHR5cGVvZiBvcHRzLmNvcm5lckNvbG9yID09PSBcInVuZGVmaW5lZFwiKSBvcHRzLmNvcm5lckNvbG9yID0gXCJmZmZmZmZcIjtcbiAgICB2YXIgYmFzZVVybCA9IFwiaHR0cDovL2NoYXJ0LmFwaXMuZ29vZ2xlLmNvbS9jaGFydD9jaHQ9bW1cIjtcbiAgICB2YXIgaWNvblVybCA9IGJhc2VVcmwgKyBcIiZjaHM9XCIgKyB3aWR0aCArIFwieFwiICsgaGVpZ2h0ICsgXCImY2hjbz1cIiArXG4gICAgICAgICAgICAgICAgIG9wdHMuY29ybmVyQ29sb3IucmVwbGFjZShcIiNcIiwgXCJcIikgKyBcIixcIiArIGljb25fY29sb3IgKyBcIixcIiArXG4gICAgICAgICAgICAgICAgIG9wdHMuc3Ryb2tlQ29sb3IucmVwbGFjZShcIiNcIiwgXCJcIikgKyBcIiZleHQ9LnBuZ1wiO1xuXG4gICAgcmV0dXJuIGFwcGx5RGVmYXVsdHMoe1xuICAgICAgICB1cmwgICAgOiBpY29uVXJsLFxuICAgICAgICBzaXplICAgOiBuZXcgZ29vZ2xlLm1hcHMuU2l6ZSh3aWR0aCwgaGVpZ2h0KSxcbiAgICAgICAgb3JpZ2luIDogbmV3IGdvb2dsZS5tYXBzLlBvaW50KDAsIDApLFxuICAgICAgICBhbmNob3IgOiBuZXcgZ29vZ2xlLm1hcHMuUG9pbnQod2lkdGgvMiwgaGVpZ2h0KVxuICAgIH0sIG9wdHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTWFya2VyRGF0YShvcHRzKSB7XG4gICAgcmV0dXJuIGFwcGx5RGVmYXVsdHMoe1xuICAgICAgICBpY29uOiBjcmVhdGVNYXJrZXJJY29uT3B0cyhvcHRzKSxcbiAgICAgICAgY29udGVudCA6IFwiTWFya2VyXCJcbiAgICB9LCBvcHRzKTsgIFxufVxuXG4vKipcbiAqIEEgZnJlZSBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgbWFya2Vycy4gSW4gYWRkaXRpb24gdG8gdGhlIHBhcmFtZXRlcnMgYmVsb3csIHlvdSBjYW4gcGFzcyBhbnkgXG4gKiBvcHRpb24gbGlzdGVkIGluIEdvb2dsZSdzIHJlZmVyZW5jZTpcbiAqIGh0dHBzOi8vZGV2ZWxvcGVycy5nb29nbGUuY29tL21hcHMvZG9jdW1lbnRhdGlvbi9qYXZhc2NyaXB0L3JlZmVyZW5jZSNNYXJrZXJPcHRpb25zXG4gKiBcbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0c10gT3B0aW9ucyBmb3IgY29uZmlndXJpbmcgdGhlIG1hcmtlci4gXG4gKiBAcGFyYW0ge2dvb2dsZS5tYXBzLk1hcH0gW29wdHMubWFwPXRoaXMubWFwXSBUaGUgbWFwIG9uIHdoaWNoIHRvIGRpc3BsYXkgdGhlIG1hcmtlci4gXG4gKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRzLnZpc2libGU9ZmFsc2VdIE1ha2UgdGhlIG1hcmtlciB2aXNpYmxlIGluaXRpYWxseS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0cy5pY29uPXRoaXMuY3JlYXRlTWFya2VySWNvbk9wdHMob3B0cyldIFRoZSBtYXJrZXIncyBpY29uLlxuICogQHBhcmFtIHtmdW5jdGlvbn0gW29wdHMuZm5dIEEgZnVuY3Rpb24gY2FsbGVkIHdoZW4gdGhlIG1hcmtlciBpcyBjbGlja2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IFtvcHRzLmNvbnRlbnQ9XCJNYXJrZXJcIl0gSWYgdGhlIG1hcmtlciBkb2VzIG5vdCBoYXZlIG9wdHMuZm4gZGVmaW5lZCwgdGhpcyBcbiAqIGRldGVybWluZXMgdGhlIGNvbnRlbnQgb2YgdGhlIGluZm93aW5kb3cgZGlzcGxheWVkIHdoZW4gdGhlIG1hcmtlciBpcyBjbGlja2VkLlxuICovXG4gZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU1hcmtlcihvcHRzKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRzLnBvc2l0aW9uID09PSBcInVuZGVmaW5lZFwiICYmXG4gICAgICAgIHR5cGVvZiBvcHRzLmxhdGl0dWRlICE9PSBcInVuZGVmaW5lZFwiICYmXG4gICAgICAgIHR5cGVvZiBvcHRzLmxvbmdpdHVkZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICBvcHRzLnBvc2l0aW9uID0gbmV3IGdvb2dsZS5tYXBzLkxhdExuZyhvcHRzLmxhdGl0dWRlLCBvcHRzLmxvbmdpdHVkZSk7XG4gICAgfVxuICAgICAgICBcbiAgICB2YXIgbWFya2VyID0gbmV3IGdvb2dsZS5tYXBzLk1hcmtlcihvcHRzKTtcbiAgICBpZiAodHlwZW9mIG9wdHMuZm4gPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgdmFyIGl3ID0gbmV3IGdvb2dsZS5tYXBzLkluZm9XaW5kb3coe1xuICAgICAgICAgICAgY29udGVudDogb3B0cy5jb250ZW50XG4gICAgICAgIH0pO1xuICAgICAgICBnb29nbGUubWFwcy5ldmVudC5hZGRMaXN0ZW5lcihtYXJrZXIsIFwiY2xpY2tcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIGl3LnNldFpJbmRleChub3cuZ2V0VGltZSgpKTtcbiAgICAgICAgICAgIGl3Lm9wZW4ob3B0cy5tYXAsIG1hcmtlcik7XG4gICAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIGdvb2dsZS5tYXBzLmV2ZW50LmFkZExpc3RlbmVyKG1hcmtlciwgXCJjbGlja1wiLCBvcHRzLmZuKTtcbiAgICB9XG4gLy8gICBzZXRNYXJrZXJNZXRhKG1hcmtlciwgb3B0cyk7XG4gICAgcmV0dXJuIG1hcmtlcjtcbn1cbiAiXX0=
