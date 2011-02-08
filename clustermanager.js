/****
 * @name ClusterManager
 * @version 1.0
 * @author Marcus Ulrich
 * @fileoverview
 * This library creates and manages clusters for Google Maps API v2. It does two
 * things to make maps with large numbers of markers more useable: 1) Puts markers in 
 * close proximity to each other based on zoom level into clusters, 2) Only adds 
 * markers in the current viewport (and optional padding) to the map.
 * <b>How it works</b>:<br/>
 * The manager sets up a dictionary for clusters and a dictionary for markers. Every
 * marker that's added to the manager has a string created based on it's latitude,
 * longitude, and zoom level and that's used to add it to the cluster dictionary. Nearby
 * markers will hash to the same string so nothing has to be calculated. Nearby clusters
 * are then combined.
 * Markers can be added with optional type and subtypes so subsets of markers can be shown 
 * and hidden.
 * The function used to create the clusters is stored in its own dictionary and this function
 * can be overridden for greater control of the look of the clusters.
 *
****/

/************************************************************************************************
 * Cluster Manager
 ************************************************************************************************/

/**
 * Creates a new Cluster Manager for clustering markers on a V2 Google map.
 *
 * @constructor
 * @param {GMap2} map The map that the markers should be added to.
 * @param {Object} [opts] Same as for resetManager.
 */

ClusterManager = function(map, opts) {
    this.map = map;
    this.resetManager(opts);
    this.currentPrecision = this.zoomToPrecision(this.map.getZoom());
    GEvent.bind(map, "moveend", this, this._onMapMoveEnd);
}

/**
 * Sets the marker and clusters back to the inital state.
 *
 * @param {Object} [opts.cluster_defs] Defines a precision for each zoom level. 
 * @param {String} [opts.icon_color] Sets the default icon color. 
 * @param {Number} [opts.padding] The amount of padding in pixels where markers not in the viewport will
 *                                still be added to the map.
 * @param {Boolean} [opts.visualize] For debugging. Will put a box around each cluster with at least
 *                                   one marker.
 */
ClusterManager.prototype.resetManager = function(opts) {
    this.markers = {}; //hold markers by type, then subtype.
    this.clusters = {}; //define clusters by precision, type, then geobox.
    this.cluster_fns = {}; //store cluster function for building the cluster markers.
    this.cluster_meta = {}; //marker counts, etc
    this.cluster_precisions = {"-2": {zoom: {min: 0, max: 2}},
                               "-1": {zoom: {min: 3, max: 4}},
                                  0: {zoom: {min: 5, max: 7}}, 
                                  1: {zoom: {min: 8, max: 9}}, 
                                  2: {zoom: {min: 10, max: 11}},
                                  3: {zoom: {min: 12, max: 12}},
                                  4: {zoom: {min: 13, max: 13}},
                                  5: {zoom: {min: 14, max: 100}}}; //define the zoom level for each precision.
    opts = ClusterManager.applyDefaults({cluster_defs : this.cluster_precisions, 
                                         padding      : 200, 
                                         visualize    : false, 
                                         icon_color   : "00CC00"}, opts);
    this.opts = opts;
    this.cluster_precisions = opts.cluster_defs;
}

/**
 * Gets a zero padded string as a hash for a latitude, longitude, or other number.
 *
 * @param {Number} num The number to be hashed
 * @param {Number} precision The number of places to round to after the decimal or before w/negatives.
 * @param {Number} mod Mod the number to reduce the number of possible boxes.
 * @param {Number} tens The number of places before the decimal. This includes space for negatives.
 * @return {String} The geohash of the input number.
 *
 **/
ClusterManager.prototype.getZeroPaddedString = function(num, precision, mod, tens) {
    num = (Math.round(num * Math.pow(10, precision)) - Math.round(num * Math.pow(10, precision)) % mod)/Math.pow(10, precision);
    var numString = num + "";
    if(num > 0) numString = "0" + numString; //include space for negatives.
    var length = tens + 1; //include space for negative or zero.
    if(precision > 0) {
        length += precision + 1; //include space for decimal point.
    } else {
        length += precision; //no decimal
    }
    var tensLength = (numString.indexOf(".") === -1) ? numString.length:numString.indexOf(".");

    //pad the front with zeros.
    while(tensLength < tens+1) {
         numString = "0" + numString;
         tensLength += 1;
    }
    //pad the back with zeros.
    while(numString.length < length) {
        if(numString.length == tens+1 && precision > 0) numString += ".";
        else numString += "0";
    }
    //chop off the fat. only matters for negative precision.
    numString = numString.substr(0, length);
    return numString;
}

/**
 * This gets the geobox surrounding a specified latitude and longitude.
 *
 * @param {Number} lat The latitude to get the surrounding geobox of.
 * @param {Number} lng The longitude to get the surrounding geobox of.
 * @param {Number} precision The precision level for the geobox. Higher precisions are geographically smaller areas.
 * @return {String} A string representing the geobox. 
 */
ClusterManager.prototype.getGeoBox = function(lat, lng, precision) {
    return this.getZeroPaddedString(lat, precision, 1, 2) + this.getZeroPaddedString(lng, precision, 1, 3);
}

/**
 * Given a geobox, this returns the bounds on it's range. The inverse of getGeoBox.
 * @param {String} box_str A string representing the geobox.
 * @return {Object} GLatLngBounds representing the bounds on the geobox. 
 */
ClusterManager.prototype.boxToLatLngBounds = function(box_str) {
    var precision, lat, lng, latLength=3;
    precision = this.boxGetPrecision(box_str);
    if(precision <= 0) {
        lat = parseFloat(box_str.substr(0, latLength+precision));
    } else if(precision > 0) {
        latLength += 1; //add space for decimal.
    }

    lat = parseFloat(box_str.substr(0, latLength+precision));
    var lngBox = box_str.substr(latLength+precision);
    if(lngBox.indexOf("-") !== -1) {
        lng = parseFloat(lngBox.substr(lngBox.indexOf("-")));
    } else {
        lng = parseFloat(lngBox);
    }

    if(precision <= 0) {
        lat = lat * Math.pow(10, Math.abs(precision));
        lng = lng * Math.pow(10, Math.abs(precision));
    }

    var maxLat = lat + Math.pow(10, -precision)/2;
    var maxLng = lng + Math.pow(10, -precision)/2;
    var minLat = lat - Math.pow(10, -precision)/2;
    var minLng = lng - Math.pow(10, -precision)/2;

    return new GLatLngBounds(new GLatLng(minLat, minLng), new GLatLng(maxLat, maxLng));
}

/**
 * Derives the precision from a geobox string.
 *
 * @param {String} box_str The geobox to find the precision of.
 * @return {Number} The derived precision of the geobox.
 */
ClusterManager.prototype.boxGetPrecision = function(box_str) {
    var precision = (box_str.length - 9)/2;
    if(precision < 0) precision += 1; 
    return precision;
}

/**
 * Gets the boxes surrounding the given box in a "plus sign" shape and only returns boxes that have at least one marker.
 *
 * @param {String} box_str The geobox to find the neighbors of.
 * @param {String} type The type of the geobox to find the neighbors of.
 * @return {Array} The strings for the geoboxes with at least one marker neighboring the input geobox.
 */
ClusterManager.prototype.getNeighborBoxes = function(box_str, type) {
    var bounds = this.boxToLatLngBounds(box_str);
    var precision = this.boxGetPrecision(box_str);

    var boxString1 = this.getGeoBox(bounds.getSouthWest().lat() + 0.0001, bounds.getSouthWest().lng() - 0.0001, precision);
    var boxString2 = this.getGeoBox(bounds.getSouthWest().lat() - 0.0001, bounds.getSouthWest().lng() + 0.0001, precision);
    var boxString3 = this.getGeoBox(bounds.getNorthEast().lat() + 0.0001, bounds.getNorthEast().lng() - 0.0001, precision);
    var boxString4 = this.getGeoBox(bounds.getNorthEast().lat() - 0.0001, bounds.getNorthEast().lng() + 0.0001, precision);
    var boxStrings = [boxString1, boxString2, boxString3, boxString4];

    for(var i=0, neighbors=[], boxString; boxString=boxStrings[i]; i++) {
        if(typeof this.clusters[precision][type][boxString] !== "undefined") {
            neighbors.push(boxString);
        }
    }

    return neighbors;
}

/**
 * Given a geobox, this returns a GPolygon covering the box's bounds.
 * @param {String} box_str A string representing the geobox.
 * @param {String} opts.strokeColor The stroke color of the polygon.
 * @param {String} opts.strokeWeight 
 * @param {String} opts.strokeOpacity
 * @param {String} opts.fillColor Color of the inside of the polygon
 * @param {String} opts.fillOpacity
 * @return {Object} GPolygon covering the box's bounds.
 */
ClusterManager.prototype.boxToPolygon = function(box_str, opts) {
    opts = ClusterManager.applyDefaults({strokeColor   : "#f33f00", 
                                         strokeWeight  : 5,
                                         strokeOpacity : 1,
                                         fillColor     : "#ff0000",
                                         fillOpacity   : 0.2}, opts);
    var bounds = this.boxToLatLngBounds(box_str);
    var ne = bounds.getNorthEast();
    var sw = bounds.getSouthWest();
    var polygon = new GPolygon([ne,new GLatLng(ne.lat(), sw.lng()), sw, new GLatLng(sw.lat(), ne.lng()), ne],
                               opts.strokeColor, opts.strokeWeight, opts.strokeOpacity, opts.fillColor, opts.fillOpacity);
    return polygon;
}

/**
 * Tests whether a geobox touches a given bounds. Padding expands the range of the bounds based on viewport pixels.
 *
 * @param {String} box_str A string representing the geobox.
 * @param {Object} bounds A GLatLngBounds object covering the bounds to be tested.
 * @param {Number} [padding] Number of pixels to expand the bounds. 
 * @return {Boolean} Returns true if any part of the geobox touches the bounds expanded by the padding.
 */
ClusterManager.prototype.boxInBounds = function(box_str, bounds, padding) {
    var newBounds = new GLatLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
    if(typeof padding !== "undefined") {
        var nePixel = this.map.fromLatLngToDivPixel(bounds.getNorthEast());
        var swPixel = this.map.fromLatLngToDivPixel(bounds.getSouthWest());
        var newNE = this.map.fromDivPixelToLatLng(new GPoint(nePixel.x + padding, nePixel.y - padding));
        var newSW = this.map.fromDivPixelToLatLng(new GPoint(swPixel.x - padding, swPixel.y + padding));
        newBounds.extend(newNE);
        newBounds.extend(newSW);
    }

    var boxBounds = this.boxToLatLngBounds(box_str);

    if(newBounds.contains(boxBounds.getNorthEast()) || newBounds.contains(boxBounds.getSouthWest())) return true;
    else return false;
}


/**
 * Add a single marker to the map. Stores an associate array for looking for marker types
 * so we can cluster by type. Doesn't build clusters or add them to the map. Each
 * marker can have an opt type and subtype to cluster by. 
 *
 * @param {Marker} marker The GMarker to add. 
 * @param {String} [opts.type] A string that is used to sort which markers to cluster.
 * @param {String} [opts.subtype] A string that is used to show/hide subsets of markers of a given type.
 * @param {Boolean} [opts.hidden] Set true to make a marker disappear from the map even if it's in the viewport.
 * @param {Boolean} [opts.visible] Set true if the marker is visible in the viewport. 
 * @param {String} [opts.summary] The summary text that appears in the cluster's infowindow. Clicking on the
 *                              text opens the markers infowindow.
 */
ClusterManager.prototype.addMarker = function(marker, opts) {
    var me=this;
 
    if(typeof opts === "undefined") opts = this.getMarkerMeta(marker);
    //Set when the marker is visible in the viewport and not hidden.
    //Set when we want to hide the marker even if it's in the viewport.
    var defaults = {type    : "generic",
                    subtype : "generic",
                    hidden  : true,
                    visible : false};
    opts = ClusterManager.applyDefaults(defaults, opts);
    var type=opts.type, subtype=opts.subtype;

    //if this is the first marker of the type, save the cluster function.
    if(typeof this.markers[type] === "undefined") {
        this.markers[type] = {};
        this.cluster_meta[type] = {count: {total:0, visible:0, cluster:0}}; 
    }
    if(typeof this.cluster_fns[type] === "undefined") {
        this.cluster_fns[type] = function(marker_list, center, precision, map) {return me.createClusterMarker(marker_list, center, precision, map);};
    }
    //if this is the first marker of the subtype, set up an empty array to save it in.
    if(typeof this.markers[type][subtype] === "undefined") {
        this.markers[type][subtype] = [];
    }
    this.markers[type][subtype].push(marker);
    if(subtype !== "cluster") {
        this.cluster_meta[type]["count"]["total"] += 1; 
        this.addToCluster(marker, type, this.currentPrecision);
    }
    if(typeof opts.summary === "undefined") {
        var capType = opts.type.charAt(0).toUpperCase() + opts.type.slice(1);
        opts.summary = typeof marker.getTitle() === "undefined" ? capType + " marker "+this.count(opts.type, "total"):marker.getTitle();
    }
    this.setMarkerMeta(marker, opts);
}

/**
 * Returns the number of markers of a particular type.
 *
 * @param {Number} type The type of marker to count.
 * @return {Number} The number of markers of a particular type.
 */
ClusterManager.prototype.count = function(type, count_type) {
    return this.cluster_meta[type]["count"][count_type];
}

/**
 * Adds a marker to a cluster object. Does not create the cluster markers.
 *
 * @param {Marker} marker The marker to add. 
 * @param {String} type The type of the marker to add. This will be used to form cluster groups. If no
 *                      type is given it is assigned type "generic".
 * @param {Number} precision The precision to cluster at.
 * @param {String} [box_str] Force a marker into a particular geobox rather than its default one.
 */
ClusterManager.prototype.addToCluster = function(marker, type, precision, box_str) {
    var clusters = this.clusters;
    var markerLL = marker.getLatLng();
    var markerLat = markerLL.lat();
    var markerLng = markerLL.lng();
    if(typeof clusters[precision] === "undefined") {
        clusters[precision] = {};
    }
    if(typeof clusters[precision][type] === "undefined") {
        clusters[precision][type] = {};
    }
    var cluster = clusters[precision][type];
    if(typeof box_str === "undefined") box_str = this.getGeoBox(markerLat, markerLng, precision);

    if(typeof cluster[box_str] !== "undefined") { 
        cluster[box_str]["markers"].push(marker);
        var length = cluster[box_str]["markers"].length;
        var lat = ((length-1)/length)*cluster[box_str]["center"][0] + markerLat/length;
        var lng = ((length-1)/length)*cluster[box_str]["center"][1] + markerLng/length;
        cluster[box_str]["center"] = [lat, lng];
    } else {
        cluster[box_str] = {cluster: false, markers: [marker], center: [markerLat, markerLng]};
    }
}

/**
 * Removes a marker from a cluster and resets the cluster boxes properties.
 *
 * @param {Marker} marker The GMarker to remove.
 * @param {String} box_str The geobox to remove the marker from.
 */
ClusterManager.prototype.removeFromCluster = function(marker, box_str) {
    var precision = this.boxGetPrecision(box_str);
    var type = this.getMarkerMeta(marker).type;
    var box = this.clusters[precision][type][box_str];

    if(box["markers"].length === 1) {
        delete(this.clusters[precision][type][box_str]);        
    } else if(box["markers"].length > 1) {
        for(var i=0, new_markers=[], center_lat=0, center_lng=0, test_marker; test_marker=box["markers"][i]; i++) {
            if(test_marker !== marker) {
                new_markers.push(test_marker);
                center_lat = center_lat + test_marker.getLatLng().lat();
                center_lng = center_lng + test_marker.getLatLng().lng();
            }
        }
        center_lat = center_lat/new_markers.length;
        center_lng = center_lng/new_markers.length;
        box["center"] = [center_lat, center_lng];
        box["markers"] = new_markers;
        box["cluster"] = false;
        this.clusters[precision][type][box_str] = box;
    }
}

/**
 * This takes two geoboxes and puts all the markers into the one with more markers or the first one.
 * 
 * @param {String} box_str1 First box to combine.
 * @param {String} box_str2 Second box to combine.
 * @param {String} type Type of the boxes since this can't be derived.
 */
ClusterManager.prototype.combineBoxes = function(box_str1, box_str2, type) {
    var precision = this.boxGetPrecision(box_str1);
    if(this.clusters[precision][type][box_str1]["markers"].length < this.clusters[precision][type][box_str2]["markers"].length) {
        var temp = box_str1;
        box_str1 = box_str2;
        box_str2 = temp;
    }

    var length = this.clusters[precision][type][box_str2]["markers"].length;
    for(var i=length-1, marker; i>=0; i--) {
        marker = this.clusters[precision][type][box_str2]["markers"][i];
        this.removeFromCluster(marker, box_str2);
        this.addToCluster(marker, type, precision, box_str1);
    }
}

/**
 * This builds the actual clusters but does not set up the cluster dictionary.
 *
 * @param {String} [type] The group type to cluster. If none is given, this sets up the clusters for every group in the
 * clusterer.
 */
ClusterManager.prototype.cluster = function(type) {
    var precision = this.currentPrecision;

    if(typeof type === "undefined") {
        var clusters = this.clusters[precision];
        for(var type in clusters) {
            this.cluster(type);
        }
        return;
    }
    var iw = this.map.getInfoWindow();
    var iw_hidden = iw.isHidden();
    if(typeof this.markers[type] === "undefined") return; //no markers to cluster

    if(typeof this.markers[type]["cluster"] !== "undefined") {
        for(var i=0, marker; marker=this.markers[type]["cluster"][i]; i++) this.map.removeOverlay(marker);
    }
    this.markers[type]["cluster"] = [];
    this.cluster_meta[type]["count"]["cluster"] = 0;
    var clusters = this.clusters;

    for(var boxStr in clusters[precision][type]) {
        var neighbors = this.getNeighborBoxes(boxStr, type);
        var distance = Math.pow(10, -precision);
        for(var j=0, neighborStr; neighborStr=neighbors[j]; j++) {
            if(Math.abs(clusters[precision][type][boxStr]["center"][0] - clusters[precision][type][neighborStr]["center"][0]) < distance &&
               Math.abs(clusters[precision][type][boxStr]["center"][1] - clusters[precision][type][neighborStr]["center"][1]) < distance) {
                this.combineBoxes(boxStr, neighborStr, type);
                break;
            }
        }
    }

    for(var boxStr in clusters[precision][type]) {
        //visualize the boxes by adding polygons to the map for debugging.
        if(this.opts.visualize) this.map.addOverlay(this.boxToPolygon(boxStr));

        var cluster = clusters[precision][type][boxStr];
        for(var i=0, cluster_markers=[]; marker=cluster["markers"][i]; i++) {
            var meta = this.getMarkerMeta(marker);
            if(typeof meta.hidden === "undefined" || !meta.hidden) {
                cluster_markers.push(marker); 
            }
        }
        if(cluster_markers.length > 1) { 
            cluster["cluster"] = this.cluster_fns[type](cluster_markers, cluster["center"], precision, this.map);
            this.addMarker(cluster["cluster"], {type: type, subtype: "cluster", hidden: false});
            this.cluster_meta[type]["count"]["cluster"] += 1;
        } else {
            cluster["cluster"] = false;
        }
    }

    if(!iw_hidden) {
        this.map.openInfoWindow(iw.getPoint(), iw.getContentContainers()[0]);
    }
}


/**
 * Gets the markers of a given type and/or subtype. Returns all markers if passed no parameters.
 *
 * @param {String} [type] The type of the markers to return.
 * @param {String} [subtype] The subtype of the markers to return.
 * @param {String | Boolean} [visible] Pass "all" to get markers that aren't clusters.
                                       Pass true to get all markers that are visible and not hidden.
 * @return {Array} The markers of the given type.
 */
ClusterManager.prototype.getMarkers = function(type, subtype, visible) {
    var markers = [];
    if(this.markers === {}) return []; //no markers of any type.
    if(typeof type === "undefined") {
        for(var type in this.markers) {
            for(var subtype in this.markers[type]) {
                markers = markers.concat(this.markers[type][subtype]);
            }
        }
    } else if(typeof subtype === "undefined") {
        for(var subtype in this.markers[type]) {
            markers = markers.concat(this.markers[type][subtype]); //access all subcategories with a string.
        }
    } else { 
        try {
            markers = this.markers[type][subtype] || [];
        } catch(err) {
            markers = [];
        }
    }
    if(typeof visible === "undefined") return markers;
    for(var i=0, marker, final_markers=[]; marker=markers[i]; i++) {
        var meta = this.getMarkerMeta(marker);
        if(visible === "all" || meta.hidden !== visible && meta.visible == visible && typeof marker !== "function" && meta.type !== "cluster") {
            final_markers.push(marker);
        }
    }
    return final_markers;
}

/**
 * Handles any change in the map viewport. Calls updateMarkers with a timeout so it doesn't
 * lock up the map.
 */
ClusterManager.prototype._onMapMoveEnd = function() {
    var me=this;
    var precision = this.zoomToPrecision(this.map.getZoom());
    if(this.currentPrecision !== precision) {
        this.changePrecision(precision);
    } else {
        setTimeout(function() {me.updateMarkers();}, 10);
    }
}

/**
 * Shows markers of a input type.
 *
 * @param {String} type The type of markers to show.
 * @param {String} subtype The subtype of markers to show.
 */
ClusterManager.prototype.show = function(type, subtype) {
    this._showHide(type, subtype, false);
}

/**
 * Hides markers of the input type.
 *
 * @param {String} type The type of markers to hide.
 * @param {String} subtype The subtype of markers to hide.
 */
ClusterManager.prototype.hide = function(type, subtype) {
    this._showHide(type, subtype, true);
}


/**
 * Does the actual showing or hiding.
 */
ClusterManager.prototype._showHide = function(type, subtype, hide) {
    var markers = this.getMarkers(type, subtype);
    for(var i=0, marker; marker=markers[i]; i++) {
        this.getMarkerMeta(marker).hidden = hide;
    }
    this._lagUpdate(type);
}


/**
 * Since clustering takes time, this sets up a delay before reclustering.
 */
ClusterManager.prototype._lagUpdate = function(type) {
    var me = this;
    if(typeof this.processingTimeout !== "undefined") { clearTimeout(me.processingTimeout); 
                                                        delete(me.processingTimeout);};
    this.processingTimeout = setTimeout(function() { delete(me.processingTimeout);
                                                     me.clear(type);
                                                     me.cluster(type);
                                                     me.updateMarkers();
                                                     }, 300);
}


/**
 * This sets a cluster type to an empty state.
 *
 * @param {String} type The group type to reset.
 */
ClusterManager.prototype.reset = function(type) {
    this.clear(type);
    //this for loop should probably be a reset cluster function
    for(var precision in this.clusters) {
        delete(this.clusters[precision][type]);
        this.clusters[precision][type] = {};
    }
    delete(this.markers[type]);
    this.markers[type] = {};
}


/**
 * This removes all the markers from the map.
 */
ClusterManager.prototype.clear = function(type) {
    var markers = this.getMarkers(type);

    for(var i=0, marker; marker=markers[i]; i++) {
        this.map.removeOverlay(marker);
        this.getMarkerMeta(marker).visible = false;
    }
    if(typeof type !== "undefined") {
        this.cluster_meta[type]["count"]["visible"] = 0;
    } else {
        for(var item in this.cluster_meta) {
            this.cluster_meta[item]["count"]["visible"] = 0;
        }
    }

}


/**
 * Convert a map zoom level to a precision.
 *
 * @param {Number} zoom_level The map zoom level
 * @return {Number} The precision of the input zoom level. Null if the precision is not in a range.
 */
ClusterManager.prototype.zoomToPrecision = function(zoom_level) {
    for(var precision in this.cluster_precisions) {
        var ranges = this.cluster_precisions[parseInt(precision)];
        if(zoom_level >= ranges.zoom.min && zoom_level <= ranges.zoom.max) {
            return parseInt(precision);
        }
    }
    return null;
}


/**
 * Called whenever the viewport change also requires a change in precision level for the clusterer.
 * To speed up clustering and reduce memory, only the clusters for the current precision are calculated
 * so changing the precision may take extra time to calculate clusters at the new precision.
 * @param {Number} The precision level to set as the current precision.
 */
ClusterManager.prototype.changePrecision = function(precision) {
    this.currentPrecision = precision;
    this.clear();
    if(typeof this.clusters[precision] === "undefined") {
        var markers = this.getMarkers();
        for(var i=0, marker; marker=markers[i]; i++) {
            if(this.getMarkerMeta(marker).subtype !== "cluster") {
                this.addToCluster(marker, this.getMarkerMeta(marker).type, precision);
            }
        }
    }
    this.cluster();
    this.updateMarkers();
}

/**
 * Updates the markers on the map based on the current viewport with padding.
 */
ClusterManager.prototype.updateMarkers = function() {
    var me=this;
    var precision = this.currentPrecision;
    var currentBounds = this.map.getBounds();
    var cluster = this.clusters[precision];
    for(var type in cluster) {
        var type_cluster = cluster[type];
        for(var box in type_cluster) {
            var cluster_box = type_cluster[box];
            var cluster_box_meta = this.getMarkerMeta(cluster_box["cluster"]);
            if(this.boxInBounds(box, currentBounds, this.opts.padding)) {
                if(cluster_box["cluster"]) {
                    if(!cluster_box_meta.hidden && !cluster_box_meta.visible) {
                        for(var i=0, marker; marker=cluster_box["markers"][i]; i++) {
                            this.getMarkerMeta(marker).visible = true;
                        }
                        me.map.addOverlay(cluster_box["cluster"]);
                        cluster_box_meta.visible = true;
                        this.cluster_meta[type]["count"]["visible"] += 1;
                    }
                } else {
                    var marker = cluster_box["markers"][0];
                    var meta = this.getMarkerMeta(marker);
                    if(!meta.hidden && !meta.visible) {
                        me.map.addOverlay(marker);
                        meta.visible = true;
                        this.cluster_meta[type]["count"]["visible"] += 1;
                    }
                }
            } else {
                if(cluster_box["cluster"]) {
                    me.map.removeOverlay(cluster_box["cluster"]);
                    if(cluster_box_meta.visible) this.cluster_meta[type]["count"]["visible"] -= 1;
                    cluster_box_meta.visible = false;
                } else {
                    for(var i=0, marker; marker=cluster_box["markers"][i]; i++) {
                        var meta = this.getMarkerMeta(marker);
                        me.map.removeOverlay(marker);
                        if(meta.visible) this.cluster_meta[type]["count"]["visible"] -= 1;
                        meta.visible = false;
                    }
                }
            }
        }
    }
}

/**
 * Sets the clustering function for a given type of markers. 
 * 
 * @param {String} type The type the clustering function is set up for.
 * @param {Function} fn The function that is used to cluster the markers. See
 *                      ClusterManager.createClusterMarker for an example of
 *                      its parameters and return value.
 */
ClusterManager.prototype.setClusterFn = function(type, fn) {
    this.cluster_fns[type] = fn;
}


/**
 * Sets the markers meta properties. Properties already set are treated as defaults.
 */
ClusterManager.prototype.setMarkerMeta = function(marker, meta) {
    marker._cluster_meta = ClusterManager.applyDefaults(marker._cluster_meta, meta);
}

/**
 * Get a markers extra data.
 * @param {Object} marker A GMarker.
 * @return {Ojbect} The object with extra data about the marker.
 */
ClusterManager.prototype.getMarkerMeta = function(marker) {
    try {
        return marker._cluster_meta;
    } catch(err) {
        marker._cluster_meta = {};
        return marker._cluster_meta;
    }
}


/**
 * A free function for creating cluster icons.
 */
ClusterManager.prototype.createClusterIcon = function(number, precision) {
    var size = ((number + "").length - 1)*6 + 24;

    if(precision > 1) {
        var iconOpts = {"image"    : 'http://chart.apis.google.com/chart?cht=d&chdp=mapsapi&chl=pin%27i\\%27[' + 
                                      number + '%27-2%27f\\hv%27a\\]h\\]o\\' + this.opts.icon_color + '%27fC\\000000%27tC\\000000%27eC\\Lauto%27f\\&ext=.png',
                        "iconSize" : new GSize(21, 34)};    
    } else {
        var imageMap = [];
        var polyNumSides = 8;
        var polySideLength = 360/polyNumSides;
        var polyRadius = Math.min(size, size)/2;
        for(var a=0; a<(polyNumSides+1); a++) {
            var aRad = polySideLength * a * (Math.PI/180);
            var pixelX = polyRadius + polyRadius * Math.cos(aRad);
            var pixelY = polyRadius + polyRadius * Math.sin(aRad);
            imageMap.push(parseInt(pixelX), parseInt(pixelY));
        } 
        var iconOpts = { "shadow"           : new GSize(0, 0),
                         "iconSize"         : new GSize(size, size), 
                         "iconAnchor"       : new GPoint(size/2, size/2), 
                         "infoWindowAnchor" : new GPoint(size/2, size/2),
                         "imageMap"         : imageMap,
                         "image"            : "http://chart.apis.google.com/chart?cht=it&chs=" + size + "x" + size + "&chco=" + this.opts.icon_color + ",000000ff,ffffff01&chl=" + 
                                               number + "&chx=000000,0&chf=bg,s,00000000&ext=.png"};
    }
    return this.createIcon(iconOpts);
}


/**
 * A free function for creating cluster markers.
 */
ClusterManager.prototype.createClusterMarker = function(marker_list, center, precision, map) {
    var me=this;
    var htmlEl = document.createElement("div");
    htmlEl.style.width = "400px";
    function markerClickClosure(marker) {
        return function() {
            map.closeInfoWindow(); 
            var meta = me.getMarkerMeta(marker);
            if(typeof meta.fn !== "undefined") {
                meta.fn();
            } else {
                map.openInfoWindowHtml(marker.getLatLng(), meta.content, {maxTitle: meta.maxTitle, maxContent: meta.maxContent});
            }
        };
    }
    for(var i=0, marker; marker=marker_list[i]; i++) {
        var markerSpan = document.createElement("span");
        markerSpan.innerHTML = '<b>' + this.getMarkerMeta(marker).summary + '</b><br>'
        markerSpan.onclick = markerClickClosure(marker);
        markerSpan.style.color = "#334499";
        markerSpan.style.cursor = "pointer";
        htmlEl.appendChild(markerSpan);
        if(i>=9) break;
    }

    if(marker_list.length > 10) {
        htmlEl.appendChild(document.createTextNode((marker_list.length - 10) + " more markers in this area. Zoom in for details."));
    }

    if(precision <= 1) var zIndexProcess = function(marker, b) {return marker.getZIndex*marker_list.length;};
    else var zIndexProcess = undefined;
    
    var marker = this.createMarker(center[0], center[1], 
                                         {"title"         : marker_list.length + " markers",
                                          "content"       : htmlEl,
                                          "summary"       : marker_list.length + " markers",
                                          "icon"          : this.createClusterIcon(marker_list.length, precision),
                                          "zIndexProcess" : zIndexProcess
                                          });
    return marker;
}


/**
 * A free function for creating GIcons.
 */
ClusterManager.prototype.createIcon = function(opts) {
    if(typeof opts === "undefined") opts = {};
    if(typeof opts.width === "undefined") opts.width = 32;
    if(typeof opts.height === "undefined") opts.height = 32;
    var width=opts.width, height=opts.height;

    if(typeof opts.strokeColor === "undefined") opts.strokeColor = "#000000";
    if(typeof opts.cornerColor === "undefined") opts.cornerColor = "#ffffff"; 
    var baseUrl = "http://chart.apis.google.com/chart?cht=mm";
    var iconUrl = baseUrl + "&chs=" + width + "x" + height + "&chco=" + opts.cornerColor.replace("#", "") + "," +
                  this.opts.icon_color + "," + opts.strokeColor.replace("#", "") + "&ext=.png"; 

    opts = ClusterManager.applyDefaults({"image"            : iconUrl,
                                         "iconSize"         : new GSize(width, height), 
                                         "iconAnchor"       : new GPoint(width/2, height), 
                                         "infoWindowAnchor" : new GPoint(width/2, Math.floor(height/12)),
                                         "transparent"      : iconUrl + "&chf=a,s,ffffff11&ext=.png",
                                         "printImage"       : iconUrl + "&chof=gif",
                                         "mozPrintImage"    : iconUrl + "&chf=bg,s,ECECD8" + "&chof=gif",
                                         "shadowSize"       : new GSize(Math.floor(width*1.6), height),
                                         "imageMap"         : [width/2, height,
                                                              (7/16)*width, (5/8)*height,
                                                              (5/16)*width, (7/16)*height,
                                                              (7/32)*width, (5/16)*height,
                                                              (5/16)*width, (1/8)*height,
                                                              (1/2)*width, 0,
                                                              (11/16)*width, (1/8)*height,
                                                              (25/32)*width, (5/16)*height,
                                                              (11/16)*width, (7/16)*height,
                                                              (9/16)*width, (5/8)*height]}, opts);
    for(var i=0; i<opts.imageMap.length; i++) {
        opts.imageMap[i] = parseInt(opts.imageMap[i]);
    } 

    var icon = new GIcon(G_DEFAULT_ICON);
    for(var index in opts) {
        icon[index] = opts[index];
    }
    return icon;
}


/**
 * A free function for creating GMarkers.
 */
ClusterManager.prototype.createMarker = function(lat, lng, opts) {
    var icon = this.createIcon();
    var defaults = {
           "icon"          : icon,
           "content"       : "Marker",
           "maxTitle"      : undefined,
           "maxContent"    : undefined,
           "fn"            : undefined,
           "zIndexProcess" : undefined
        };
    opts = ClusterManager.applyDefaults(defaults, opts);

    var marker = new GMarker(new GLatLng(lat, lng), {title:opts.title, icon:opts.icon, zIndexProcess:opts.zIndexProcess});

    if(typeof opts.fn === "undefined") {
        var fn = function() { marker.openInfoWindowHtml(opts.content, {maxTitle: opts.maxTitle, maxContent: opts.maxContent});};
    } else {
        var fn = opts.fn;
    }

    this.setMarkerMeta(marker, opts);

    GEvent.addListener(marker, "click", fn);
    return marker;
}


/**
 * Tool for setting defaults.
 */
ClusterManager.applyDefaults = function(defaults, opts) {
    if(typeof defaults !== "object") return opts;
    if(typeof opts !== "object") return defaults;

    for(var index in defaults) {
        if(typeof opts[index] === "undefined") {
            opts[index] = defaults[index];
        }
    }
    return opts;
}

