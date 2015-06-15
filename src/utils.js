'use strict';

/**
 * Tool for applying defaults. Any property in defaults will be overwritten by a corresponding
 * property in opts. If the property does not exist, the default remains. Only properties in 
 * defaults will be included in the final object.
 * 
 * @param {object} [defaults]
 * @param {object} [opts]
 * @returns {object} 
 */
 export function applyDefaults(defaults, opts) {
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
export function createMarkerIconOpts(opts) {
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
    var iconUrl = baseUrl + "&chs=" + width + "x" + height + "&chco=" +
                 opts.cornerColor.replace("#", "") + "," + icon_color + "," +
                 opts.strokeColor.replace("#", "") + "&ext=.png";

    return applyDefaults({
        url    : iconUrl,
        size   : new google.maps.Size(width, height),
        origin : new google.maps.Point(0, 0),
        anchor : new google.maps.Point(width/2, height)
    }, opts);
}

export function createMarkerData(opts) {

    return applyDefaults({
        icon: createMarkerIconOpts(opts),
        visible : false,
        content : "Marker"
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
 export function createMarker(opts) {

    var marker = new google.maps.Marker(opts);
    if (typeof opts.fn === "undefined") {
        var iw = new google.maps.InfoWindow({
            content: opts.content
        });
        google.maps.event.addListener(marker, "click", function() {
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
 