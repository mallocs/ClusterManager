'use strict';
import applyDefaults from './utils';

//var applyDefaults = require('./utils');

function LazyMarker(raw_marker) {
    this.raw_marker = raw_marker;
    if (typeof raw_marker.setMap === "function") {
        this._marker = raw_marker;
    } else {
        this._marker = null;
    }
    google.maps.event.addListener(this, "click", function (e) {
        if (this._marker) {
            google.maps.event.trigger(this._marker, "click", e);
        }
    });
}

LazyMarker.prototype.setMap = function (map) {
    if (this._marker) {
        this._marker.setMap(map);
        return;
    }
    if (!map) return;

    var defaults = {
        title: this.raw_marker.title,
        type: false,
        subtype: "",
        content: ""
    };
    var opts = applyDefaults(defaults, this.raw_marker);

    this._marker = ClusterManager.prototype.createMarker({
        title: opts.title,
        type: opts.type,
        content: opts.content,
        position: new google.maps.LatLng(opts.latitutde,
                                        opts.longitude),
        subtype: opts.subtype
    });

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
    return (this._marker && this._marker.getTitle()) || this.raw_marker.title;
};

LazyMarker.prototype.setVisible = function (visible) {
    this._marker && this._marker.setVisible(visible);
};

//module.exports = LazyMarker;
export default LazyMarker;
//window.LazyMarker = LazyMarker;