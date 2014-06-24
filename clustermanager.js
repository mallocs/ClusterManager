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
ClusterManager = function(map, opts) {
    var me = this;
    opts = opts || {};
    this.map = map;
    this.setMap(map);
    this.resetManager(opts);
    this.setPrecision(this.zoomToPrecision(this.map.getZoom()));
    google.maps.event.addDomListener(map, "dragstart", function() {
        me.mapDragging = true;
    });
    google.maps.event.addDomListener(map, "dragend", function() {
        me.mapDragging = false;
        me._onMapMoveEnd();
    });
    google.maps.event.addDomListener(map, "center_changed", function() {
        if (!me.mapDragging) me._onMapMoveEnd();
    });
    google.maps.event.addDomListener(map, "zoom_changed", function() {
        me._onMapMoveEnd();
    });
    if (typeof opts.markers !== "undefined") this.addMarkers(opts.markers);
};

ClusterManager.prototype = new google.maps.OverlayView();
/**
 * @ignore
 * This is implemented only so we can tell when the map is ready and to get the custom overlay 
 * functionality.
 */
ClusterManager.prototype.onAdd = function() {
    this.ready_ = true;
    google.maps.event.trigger(this, "ready_");
};

/**
 * @ignore
 */
ClusterManager.prototype.draw = function() {};

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
ClusterManager.prototype.resetManager = function(opts) {
    this.markers = {}; //hold markers by type, then subtype.
    this.clusters = {}; //define clusters by precision, type, then geobox.
    this.cluster_fns = {}; //store cluster function for building the cluster markers.
    this.cluster_meta = {}; //marker counts, etc
    var precision = opts.precision >= 0 && opts.precision <= 27 ? opts.precision:2;
    opts = ClusterManager.applyDefaults({
        padding                 : 200,
        visualize               : false,
        zoom_to_precision       : function(zoom_level) {
            return zoom_level + precision;
        },
        cluster_by_distance     : true,
        cluster_distance_factor : 2048000,
        icon_color              : "00CC00"
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
ClusterManager.prototype.setPrecision = function(precision) {
    if(precision >= 50 || precision < 0) return;
    this.current_precision_ = precision;
    this.clear();
    if (typeof this.clusters[precision] === "undefined") {
        var markers = this.getMarkers();
        for(var i=0, length=markers.length; i<length; i++) { 
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
ClusterManager.prototype.getPrecision = function() {
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
ClusterManager.prototype.getGeohash = function(lat, lng, precision) {
    lat = Math.min(lat, 90.0);
    lat = Math.max(lat, -90.0);
    lng = Math.abs((lng+180.0)%360.0) - 180.0;

    if (precision <= 0) return "";
    var max_power = 12 //This is the limit for maximum range of decimal numbers in javascript.
    // Make the latitude and longitude positive and then mulitiply them by 10^12 to get rid of
    // as many decimal places as possible. Then change this to binary.
    var latBase = parseInt((lat + 90.0) * (Math.pow(10, max_power))).toString(2);
    var lngBase = parseInt((lng + 180.0) * (Math.pow(10, max_power))).toString(2);
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
ClusterManager.prototype.geohashGetLatLngBounds = function(geohash) {
    var max_power = 12;
    var precision = this.geohashGetPrecision(geohash);
    var fortyninezeros = "0000000000000000000000000000000000000000000000000";
    var latMinHashBin = geohash.substr(0, precision) + fortyninezeros.substr(0, 49 - precision);
    var lngMinHashBin = geohash.substr(precision, geohash.length) 
                      + fortyninezeros.substr(0, 49 - precision);
    var fortynineones = "1111111111111111111111111111111111111111111111111";
    var latMaxHashBin = geohash.substr(0, precision) + fortynineones.substr(0, 49 - precision);
    var lngMaxHashBin = geohash.substr(precision, geohash.length) 
                      + fortynineones.substr(0, 49 - precision);
    var latMinHashDec = parseInt(latMinHashBin, 2);
    var lngMinHashDec = parseInt(lngMinHashBin, 2);
    var latMaxHashDec = parseInt(latMaxHashBin, 2);
    var lngMaxHashDec = parseInt(lngMaxHashBin, 2);
    var latMin = Math.max(-90.0,  (latMinHashDec / Math.pow(10, max_power)) - 90);
    var lngMin = Math.max(-180.0, (lngMinHashDec / Math.pow(10, max_power)) - 180);
    var latMax = Math.min(90.0,   (latMaxHashDec / Math.pow(10, max_power)) - 90);
    var lngMax = Math.min(180.0,  (lngMaxHashDec / Math.pow(10, max_power)) - 180);
    return new google.maps.LatLngBounds(new google.maps.LatLng(latMin, lngMin), 
                                        new google.maps.LatLng(latMax, lngMax));
};

/**
 * Derives the precision from a geohash string.
 *
 * @param {string} geohash The geohash to find the precision of.
 * @returns {number} The derived precision of the geobox.
 * @private
 */
ClusterManager.prototype.geohashGetPrecision = function(geohash) {
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
ClusterManager.prototype.getNeighborBoxes = function(box_str, type) {
    var bounds = this.geohashGetLatLngBounds(box_str);
    var precision = this.geohashGetPrecision(box_str);
    var boxString1 = this.getGeohash(bounds.getSouthWest().lat() + 0.0001, 
                                     bounds.getSouthWest().lng() - 0.0001, precision);
    var boxString2 = this.getGeohash(bounds.getSouthWest().lat() - 0.0001, 
                                     bounds.getSouthWest().lng() + 0.0001, precision);
    var boxString3 = this.getGeohash(bounds.getNorthEast().lat() + 0.0001, 
                                     bounds.getNorthEast().lng() - 0.0001, precision);
    var boxString4 = this.getGeohash(bounds.getNorthEast().lat() - 0.0001, 
                                     bounds.getNorthEast().lng() + 0.0001, precision);
    var boxString5 = this.getGeohash(bounds.getSouthWest().lat() + 0.0001, 
                                     bounds.getSouthWest().lng() + 0.0001, precision);
    var boxString6 = this.getGeohash(bounds.getSouthWest().lat() - 0.0001, 
                                     bounds.getSouthWest().lng() - 0.0001, precision);
    var boxString7 = this.getGeohash(bounds.getNorthEast().lat() + 0.0001, 
                                     bounds.getNorthEast().lng() + 0.0001, precision);
    var boxString8 = this.getGeohash(bounds.getNorthEast().lat() - 0.0001, 
                                     bounds.getNorthEast().lng() - 0.0001, precision);
    var boxStrings = [boxString1, boxString2, boxString3, boxString4, boxString5, boxString6, 
                      boxString7, boxString8];
    for (var i = 0, neighbors = [], boxString; boxString = boxStrings[i]; i++) {
        if (typeof this.clusters[precision][type][boxString] !== "undefined" 
            && boxString !== box_str) {
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
ClusterManager.prototype.boxToPolygon = function(geohash, opts) {
    opts = ClusterManager.applyDefaults({
        map           : this.map,
        strokeColor   : "#f33f00",
        strokeWeight  : 5,
        strokeOpacity : 1,
        fillColor     : "#ff0000",
        fillOpacity   : 0.2
    }, opts);
    var bounds = this.geohashGetLatLngBounds(geohash);  //TODO:change back!!
    var ne = bounds.getNorthEast();
    var sw = bounds.getSouthWest();
    var polygon = new google.maps.Polygon({
        paths         : opts.paths || [ne, new google.maps.LatLng(ne.lat(), sw.lng()), sw, 
                         new google.maps.LatLng(sw.lat(), ne.lng()), ne],
        strokeColor   : opts.strokeColor,
        strokeWeight  : opts.strokeWeight,
        strokeOpacity : opts.strokeOpacity,
        fillColor     : opts.fillColor,
        fillOpacity   : opts.fillOpacity,
        map           : opts.map
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
ClusterManager.prototype.boxInBounds = function(geohash, bounds, padding) {
    //make a new LatLngBounds so we don't have any side effects on our map bounds.
    var newBounds = new google.maps.LatLngBounds(this.map.getBounds().getSouthWest(), 
                                                 this.map.getBounds().getNorthEast());
    if (typeof padding !== "undefined") {
        var proj = this.map.getProjection();
        var scale = Math.pow(2, this.map.getZoom());
        var pixelOffset = new google.maps.Point((padding / scale) || 0, (padding / scale) || 0);
        var nePoint = proj.fromLatLngToPoint(bounds.getNorthEast());
        var swPoint = proj.fromLatLngToPoint(bounds.getSouthWest());
        var newNEPoint = new google.maps.Point(nePoint.x + pixelOffset.x, 
                                               nePoint.y - pixelOffset.y);
        var newSWPoint = new google.maps.Point(swPoint.x - pixelOffset.x, 
                                               swPoint.y + pixelOffset.y);
        var newNE = proj.fromPointToLatLng(newNEPoint);
        var newSW = proj.fromPointToLatLng(newSWPoint);
        newBounds.extend(newNE);
        newBounds.extend(newSW);
    }
    var boxBounds = this.geohashGetLatLngBounds(geohash);
    if (newBounds.contains(boxBounds.getNorthEast()) || 
        newBounds.contains(boxBounds.getSouthWest()) || 
        boxBounds.toSpan().lat() == 180) return true;
    else return false;
};

/**
 * Use this to add markers in one batch through an array.
 *
 * @param {google.maps.Marker[]} markers An array of markers.
 * @param {string} type The type for the markers being added.
 * @param {string} subtype The subtype for the markers being added.
 */
ClusterManager.prototype.addMarkers = function(markers, type, subtype) {
    if (Object.prototype.toString.call(markers) === '[object Array]') {

        for(var i=0, length=markers.length; i<length; i++) { 
            var marker = markers[i];
            this.addMarker(marker, {
                "type"    : type,
                "subtype" : subtype
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
ClusterManager.prototype.addMarker = function(marker, opts) {
    if (typeof opts === "undefined") opts = this.getMarkerMeta(marker);
    //Set when the marker is visible in the viewport and not hidden.
    //Set when we want to hide the marker even if it's in the viewport.
    var defaults = {
        type    : "generic",
        subtype : "generic",
        hidden  : true,
        visible : false
    };
    opts = ClusterManager.applyDefaults(defaults, opts);
    var type = opts.type,
        subtype = opts.subtype;
    //if this is the first marker of the type, save the cluster function.
    if (typeof this.markers[type] === "undefined") {
        this.markers[type] = {};
        this.cluster_meta[type] = {
            count: {
                total   : 0,
                visible : 0,
                cluster : 0
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
        opts.summary = typeof marker.getTitle() === "undefined" ? capType + " marker " 
                     + this.count(opts.type, "total") : marker.getTitle();
    }
    this.setMarkerMeta(marker, opts);
};

/**
 * Returns the number of markers of a particular type.
 *
 * @param {number} type The type of marker to count.
 * @returns {number} The number of markers of a particular type.
 */
ClusterManager.prototype.count = function(type, count_type) {
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
ClusterManager.prototype.addToCluster = function(marker, type, precision, geohash) {
    var clusters = this.clusters;
    var markerLL = marker.getPosition();
    var markerLat = markerLL.lat();
    var markerLng = markerLL.lng();
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
        var lat = ((length - 1) / length) * cluster[geohash]["center"][0] + markerLat / length;
        var lng = ((length - 1) / length) * cluster[geohash]["center"][1] + markerLng / length;
        cluster[geohash]["center"] = [lat, lng];
    } else {
        cluster[geohash] = {
            cluster : false,
            markers : [marker],
            center  : [markerLat, markerLng]
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
ClusterManager.prototype.removeFromCluster = function(marker, geohash) {
    var precision = this.geohashGetPrecision(geohash);
    var type = this.getMarkerMeta(marker).type;
    var geoBox = this.clusters[precision][type][geohash];
    if (geoBox["markers"].length === 1) {
        delete(this.clusters[precision][type][geohash]);
    } else if (geoBox["markers"].length > 1) {
        for (var i=0, new_markers=[], center_lat=0, center_lng=0, test_marker; 
             test_marker = geoBox["markers"][i]; i++) {
            if (test_marker !== marker) {
                new_markers.push(test_marker);
                center_lat = center_lat + test_marker.getPosition().lat();
                center_lng = center_lng + test_marker.getPosition().lng();
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
ClusterManager.prototype.combineBoxes = function(box_str1, box_str2, type) {
    var precision = this.geohashGetPrecision(box_str1);
    if (this.clusters[precision][type][box_str1]["markers"].length < 
        this.clusters[precision][type][box_str2]["markers"].length) {
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
ClusterManager.prototype.combineClustersByDistance = function(type) {
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
            var clusterCenter = clusters[precision][type][boxStr]["center"];
            var neighborCenter = clusters[precision][type][neighborStr]["center"];
            var currentDist = google.maps.geometry.spherical.computeDistanceBetween(
                              new google.maps.LatLng(clusterCenter[0], clusterCenter[1]), 
                              new google.maps.LatLng(neighborCenter[0], neighborCenter[1]));
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
ClusterManager.prototype.cluster = function(type) {
    var precision = this.getPrecision();
    if (typeof type === "undefined") {
        var clusters = this.clusters[precision];
        for (var type in clusters) {
            this.cluster(type);
        }
        return;
    }
    if (typeof this.markers[type] === "undefined") return; //no markers to cluster
    if (typeof this.markers[type]["cluster"] !== "undefined") {
        for (var i = 0, marker; marker = this.markers[type]["cluster"][i]; i++) {
            marker.setVisible(false);
        }
    }
    this.markers[type]["cluster"] = [];
    this.cluster_meta[type]["count"]["cluster"] = 0;
    var clusters = this.clusters;
    if (this.opts.cluster_by_distance) this.combineClustersByDistance(type);
    for (var boxStr in clusters[precision][type]) {
        //visualize the boxes by adding polygons to the map for debugging.
        if (this.opts.visualize) this.boxToPolygon(boxStr).setMap(this.map);
        var cluster = clusters[precision][type][boxStr];
        for (var i = 0, cluster_markers = []; marker = cluster["markers"][i]; i++) {
            var meta = this.getMarkerMeta(marker);
            if (typeof meta.hidden === "undefined" || !meta.hidden) {
                cluster_markers.push(marker);
            }
        }
        if (cluster_markers.length > 1) {
            cluster["cluster"] = this.cluster_fns[type](cluster_markers, cluster["center"][0], 
                                                        cluster["center"][1], this);
            this.addMarker(cluster["cluster"], {
                type    : type,
                subtype : "cluster",
                hidden  : false
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
ClusterManager.prototype.getMarkers = function(type, subtype, visible) {
    var markers = [];
    if (this.markers === {}) return []; //no markers of any type.
    if (typeof type === "undefined") {
        for (var type in this.markers) {
            for (var subtype in this.markers[type]) {
                markers = markers.concat(this.markers[type][subtype]);
            }
        }
    } else if (typeof subtype === "undefined") {
        for (var subtype in this.markers[type]) {
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

    for (var i=0, final_markers=[], length=markers.length; i<length; i++) {
        var marker = markers[i];
        var meta = this.getMarkerMeta(marker);
        if (visible === "all" || meta.hidden !== visible && meta.visible == visible && 
            typeof marker !== "function" && meta.type !== "cluster") {
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
ClusterManager.prototype._onMapMoveEnd = function() {
    var me = this;
    if (typeof me.moveTimeout !== "undefined") {
        clearTimeout(me.moveTimeout);
        delete(me.moveTimeout);
    }
    var precision = me.zoomToPrecision(me.map.getZoom());
    if (me.getPrecision() !== precision) {
        me.setPrecision(precision);
    } else {
        me.moveTimeout = setTimeout(function() {
            delete(me.moveTimeout);
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
ClusterManager.prototype.show = function(type, subtype) {
    this._showHide(type, subtype, false);
};

/**
 * Hides markers of the input type.
 *
 * @param {string} type The type of markers to hide.
 * @param {string} subtype The subtype of markers to hide.
 */
ClusterManager.prototype.hide = function(type, subtype) {
    this._showHide(type, subtype, true);
};

/**
 * Does the actual showing or hiding.
 * @private
 */
ClusterManager.prototype._showHide = function(type, subtype, hide) {
    var me = this;
    var markers = this.getMarkers(type, subtype);
    for(var i=0, length=markers.length; i<length; i++) { 
        var marker = markers[i];
        this.getMarkerMeta(marker).hidden = hide;
    }
    if (this.ready_) this._lagUpdate(type);
    else {
        google.maps.event.addListenerOnce(this, "ready_", function() {
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
ClusterManager.prototype._lagUpdate = function(type) {
    var me = this;
    if (typeof this.processingTimeout !== "undefined") {
        clearTimeout(me.processingTimeout);
        delete(me.processingTimeout);
    }
    this.processingTimeout = setTimeout(function() {
        delete(me.processingTimeout);
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
ClusterManager.prototype.reset = function(type) {
    if(typeof type === "undefined") {
        var clusters = this.clusters[this.getPrecision()];
        for(var type in clusters) {
            this.reset(type);
        }
        return;
    }
    this.clear(type);
    //this for loop should probably be a reset cluster function
    for(var precision in this.clusters) {
        delete(this.clusters[precision][type]);
        this.clusters[precision][type] = {};
    }
    delete(this.markers[type]);
    this.markers[type] = {};
};

/**
 * This removes the markers from the map. Use reset if you want to actually get rid of the 
 * markers.
 *  
 * @param {string} [type] The type to clear. If it is not passed, all markers managed by the 
 * clusterer will be cleared.
 */
ClusterManager.prototype.clear = function(type) {
    var markers = this.getMarkers(type);
    for(var i=0, length=markers.length; i<length; i++) { 
        var marker = markers[i];
        marker.setMap(null);
        this.getMarkerMeta(marker).visible = false;
    }
    if (typeof type !== "undefined") {
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
ClusterManager.prototype.zoomToPrecision = function(zoom_level) {
    return this.opts.zoom_to_precision(zoom_level);
};

/**
 * Updates the markers on the map based on the current viewport with padding.
 * @private
 */
ClusterManager.prototype.updateMarkers = function() {
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
                        for(var i=0, length=cluster_box["markers"].length; i<length; i++) { 
                            var marker = cluster_box["markers"][i];
                            this.getMarkerMeta(marker).visible = true;
                        }
                        cluster_box["cluster"].setMap(this.map);
                        cluster_box["cluster"].setVisible(true);
                        cluster_box_meta.visible = true;
                        this.cluster_meta[type]["count"]["visible"] += 1;
                    }
                } else {
                    var marker = cluster_box["markers"][0];
                    var meta = this.getMarkerMeta(marker);
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
                    for(var i=0, length=cluster_box["markers"].length; i<length; i++) { 
                        var marker = cluster_box["markers"][i];
                        var meta = this.getMarkerMeta(marker);
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
ClusterManager.prototype.setClusterFn = function(type, fn) {
    this.cluster_fns[type] = fn;
};

/**
 * Sets a marker's meta properties. Properties already set are treated as defaults.
 * 
 * @param {google.maps.Marker} marker
 * @param {object} meta
 */
ClusterManager.prototype.setMarkerMeta = function(marker, meta) {
    var defaults = ClusterManager.applyDefaults(meta, marker._cluster_meta);
    marker._cluster_meta = ClusterManager.applyDefaults(defaults, meta);
};

/**
 * Gets a marker's meta properties.
 * 
 * @param {google.maps.Marker} marker
 * @returns {object} The object with extra data about the marker.
 */
ClusterManager.prototype.getMarkerMeta = function(marker) {
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
ClusterManager.prototype.createClusterIcon = function(number, precision, icon_color, text_color) {
    text_color = text_color || "000000";
    if (precision > 10) {
        var iconOpts = {
            "url"  : 'http://chart.apis.google.com/chart?cht=d&chdp=mapsapi&chl=pin%27i\\%27[' + 
                      number + '%27-2%27f\\hv%27a\\]h\\]o\\' + icon_color + '%27fC\\' + text_color + 
                      '%27tC\\000000%27eC\\Lauto%27f\\&ext=.png',
            "size" : new google.maps.Size(21, 34)
        };
    } else {
        var size = ((number + "").length - 1) * 6 + 24;
        var iconOpts = {
            "size"   : new google.maps.Size(size, size),
            "anchor" : new google.maps.Point(size/2, size/2),
            "shape"  : {
                coord : [size/2, size/2, size/2],
                type  : "circle"
            },
            "url"    : "http://chart.apis.google.com/chart?cht=it&chs=" + size + "x" + size +
                       "&chco=" + icon_color + ",000000ff,ffffff01&chl=" + number + "&chx=" + 
                        text_color + ",0&chf=bg,s,00000000&ext=.png"
        };
    }
    return this.createMarkerIconOpts(iconOpts);
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
ClusterManager.prototype.createClusterMarker = function(marker_list, center_lat, center_lng, manager) {
    var htmlEl = document.createElement("div");
    htmlEl.style.width = "400px";

    function markerClickClosure(marker) {
        return function(e) {
            google.maps.event.trigger(marker, "click", e);
        };
    }
    for (var i = 0, marker; marker = marker_list[i]; i++) {
        var markerSpan = document.createElement("span");
        markerSpan.innerHTML = '<b>' + manager.getMarkerMeta(marker).summary + '</b><br>'
        markerSpan.onclick = markerClickClosure(marker);
        markerSpan.style.color = "#334499";
        markerSpan.style.cursor = "pointer";
        htmlEl.appendChild(markerSpan);
        if (i >= 9) break;
    }
    if (marker_list.length > 10) {
        htmlEl.appendChild(document.createTextNode((marker_list.length - 10) + 
                           " more markers in this area. Zoom in for details."));
    }
    var icon_color = manager.opts.icon_color[manager.getMarkerMeta(marker_list[0]).type] || 
                                                                   manager.opts.icon_color;
    var icon = manager.createClusterIcon(marker_list.length, manager.getPrecision(), icon_color);
    var marker = manager.createMarker({
        "position" : new google.maps.LatLng(center_lat, center_lng),
        "title"    : marker_list.length + " markers",
        "content"  : htmlEl,
        "summary"  : marker_list.length + " markers",
        "icon"     : icon,
        "shape"    : icon["shape"],
        "zIndex"   : marker_list.length
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
ClusterManager.prototype.createMarkerIconOpts = function(opts) {
    if (typeof opts === "undefined") opts = {};
    if (typeof opts.width === "undefined") opts.width = 32;
    if (typeof opts.height === "undefined") opts.height = 32;
    var width = opts.width,
        height = opts.height;
    //Set the icon color.
    //First check the options.
    if (typeof opts.icon_color !== "undefined") {
        if (typeof opts.icon_color === "object" && typeof opts.type !== "undefined") {
            var icon_color = opts.icon_color[opts.type] || "ff0000";
        } else {
            var icon_color = opts.icon_color;
        }
    //Then try the cluster manager options.
    } else if (typeof opts.type !== "undefined" && typeof this.opts.icon_color === "object") {
        var icon_color = this.opts.icon_color[opts.type] || "ff0000";
    } else {
        var icon_color = this.opts.icon_color || "ff0000";
    }
    if (typeof opts.strokeColor === "undefined") opts.strokeColor = "000000";
    if (typeof opts.cornerColor === "undefined") opts.cornerColor = "ffffff";
    var baseUrl = "http://chart.apis.google.com/chart?cht=mm";
    var iconUrl = baseUrl + "&chs=" + width + "x" + height + "&chco=" 
                + opts.cornerColor.replace("#", "") + "," + icon_color + "," 
                + opts.strokeColor.replace("#", "") + "&ext=.png";
    return ClusterManager.applyDefaults({
        url    : iconUrl,
        size   : new google.maps.Size(width, height),
        origin : new google.maps.Point(0, 0),
        anchor : new google.maps.Point(width/2, height)
    }, opts);
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
ClusterManager.prototype.createMarker = function(opts) {
    var me = this;
    var defaultIconOpts = this.createMarkerIconOpts(opts);
    var defaults = {
        "map"     : this.map,
        "visible" : false,
        "icon"    : defaultIconOpts,
        "content" : "Marker"
    };
    opts = ClusterManager.applyDefaults(defaults, opts);
    var marker = new google.maps.Marker(opts);
    if (typeof opts.fn === "undefined") {
        var iw = new google.maps.InfoWindow({
            content: opts.content
        });
        google.maps.event.addListener(marker, 'click', function() {
            var now = new Date();
            iw.setZIndex(now.getTime());
            iw.open(me.map, marker);
        });
    } else {
        google.maps.event.addListener(marker, 'click', opts.fn);
    }
    this.setMarkerMeta(marker, opts);
    return marker;
};

/**
 * Tool for applying defaults. Any property in defaults will be overwritten by a corresponding
 * property in opts. If the property does not exist, the default remains. Only properties in 
 * defaults will be included in the final object.
 * 
 * @param {object} [defaults]
 * @param {object} [opts]
 * @returns {object} 
 */
ClusterManager.applyDefaults = function(defaults, opts) {
    if (typeof defaults !== "object") return {};
    if (typeof opts !== "object") return defaults;
    for (var index in defaults) {
        if (typeof opts[index] === "undefined") {
            opts[index] = defaults[index];
        }
    }
    return opts;
};