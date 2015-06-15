"use strict";
import {applyDefaults, createMarker} from "./utils";

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
        if (!this._marker) this._marker = createMarker(applyDefaults(this.raw_marker, {visible: false}));
        google.maps.event.trigger(this._marker, "click", e);
    });
}

LazyMarker.prototype.setVisible = function(visible) {
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

    this._marker = createMarker(applyDefaults(defaults, this.raw_marker));
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

export default LazyMarker;