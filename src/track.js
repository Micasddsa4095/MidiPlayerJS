class Track	{
	constructor(index, data) {
		this.enabled = true;
		this.pointer = 0;
		this.lastTick = 0;
		this.lastStatus = null;
		this.index = index;
		this.data = data;
		this.delta = 0;
		this.events = [];
	}

	enable() {
		this.enabled = true;
		return this;
	}

	disable() {
		this.enabled = false;
		return this;
	}

	getCurrentByte() {
		return this.data[this.pointer];
	}

	getDeltaByteCount() {
		// Get byte count of delta VLV
		// http://www.ccarh.org/courses/253/handout/vlv/
		// If byte is greater or equal to 80h (128 decimal) then the next byte 
	    // is also part of the VLV,
	   	// else byte is the last byte in a VLV.
	   	var currentByte = this.getCurrentByte();
	   	var byteCount = 1;

		while (currentByte >= 128) {
			currentByte = this.data[this.pointer + byteCount];
			byteCount++;
		}

		return byteCount;
	}

	getDelta() {
		return Utils.readVarInt(this.data.slice(this.pointer, this.pointer + this.getDeltaByteCount()));
	}

	/**
	 * Handles event within a given track starting at specified index
	 * @param currentTick
	 * @param BOOL exportEvents If set events will be parsed and returned regardless of time.
	 */
	handleEvent(currentTick, exportEvents) {
		exportEvents = exportEvents || false;
		if (this.pointer < this.data.length && (exportEvents || currentTick - this.lastTick >= this.getDelta())) {
			let event = this.parseEvent();
			if (this.enabled) return event;
			// Recursively call this function for each event ahead that has 0 delta time?
		}

		return null;
	}

	// Parses event into JSON and advances pointer for the track
	parseEvent() {
		var eventStartIndex = this.pointer + this.getDeltaByteCount();
		var eventJson = {};
		var deltaByteCount = this.getDeltaByteCount();
		eventJson.track = this.index + 1;
		eventJson.delta = this.getDelta();
		this.lastTick = this.lastTick + eventJson.delta;

		//eventJson.raw = event;
		if (this.data[eventStartIndex] == 0xff) {
			// Meta Event

			// If this is a meta event we should emit the data and immediately move to the next event
			// otherwise if we let it run through the next cycle a slight delay will accumulate if multiple tracks
			// are being played simultaneously

			switch(this.data[eventStartIndex + 1]) {
				case 0x00: // Sequence Number
					eventJson.name = 'Sequence Number';
					break;
				case 0x01: // Text Event
					eventJson.name = 'Text Event';
					break;
				case 0x02: // Copyright Notice
					eventJson.name = 'Copyright Notice';
					break;
				case 0x03: // Sequence/Track Name
					eventJson.name = 'Sequence/Track Name';
					// Get vlv length
					var currentByte = this.pointer;
					var byteCount = 1;
					while (currentByte >= 128) {
						currentByte = this.data[this.pointer + byteCount];
						byteCount++;
					}
					eventJson.vlv = byteCount;
					var length = Utils.readVarInt(this.data.slice(eventStartIndex + 2, eventStartIndex + 2 + byteCount));
					eventJson.stringLength = length;
					eventJson.string = Utils.bytesToLetters(this.data.slice(eventStartIndex + byteCount + 2, eventStartIndex + byteCount + length + 2));
					break;
				case 0x04: // Instrument Name
					eventJson.name = 'Instrument Name';
					break;
				case 0x05: // Lyric
					eventJson.name = 'Lyric';
					break;
				case 0x06: // Marker
					eventJson.name = 'Marker';
					break;
				case 0x07: // Cue Point
					eventJson.name = 'Cue Point';
					break;
				case 0x20: // MIDI Channel Prefix
					eventJson.name = 'MIDI Channel Prefix';
					break;
				case 0x21: // MIDI Port
					eventJson.name = 'MIDI Port';
					eventJson.data = Utils.bytesToNumber([this.data[eventStartIndex + 3]]);
					break;
				case 0x2F: // End of Track
					eventJson.name = 'End of Track';
					break;
				case 0x51: // Set Tempo
					eventJson.name = 'Set Tempo';
					eventJson.data = Math.round(60000000 / Utils.bytesToNumber(this.data.slice(eventStartIndex + 3, eventStartIndex + 6)));
					this.tempo = eventJson.data;
					break;
				case 0x54: // SMTPE Offset
					eventJson.name = 'SMTPE Offset';
					break;
				case 0x58: // Time Signature
					eventJson.name = 'Time Signature';
					break;
				case 0x59: // Key Signature
					eventJson.name = 'Key Signature';
					break;
				case 0x7F: // Sequencer-Specific Meta-event
					eventJson.name = 'Sequencer-Specific Meta-event';
					break;
				default:
					eventJson.name = 'Unknown: ' + this.data[eventStartIndex + 1].toString(16);
					break;
			}

			var length = this.data[this.pointer + deltaByteCount + 2];
			// Some meta events will have vlv that needs to be handled

			this.pointer += deltaByteCount + 3 + length;

		} else if(this.data[eventStartIndex] == 0xf0) {
			// Sysex
			eventJson.name = 'Sysex';
			var length = this.data[this.pointer + deltaByteCount + 1];
			this.pointer += deltaByteCount + 2 + length;

		} else {
			// Voice event
			if (this.data[eventStartIndex] < 0x80) {
				// Running status
				eventJson.running = true;
				eventJson.noteNumber = this.data[eventStartIndex];
				eventJson.noteName = Constants.NOTES[this.data[eventStartIndex]];
				eventJson.velocity = this.data[eventStartIndex + 1];
				
				if (this.lastStatus <= 0x8f) {
					eventJson.name = 'Note off';

				} else if (this.lastStatus <= 0x9f) {
					eventJson.name = 'Note on';
				}

				this.pointer += deltaByteCount + 2;

			} else {
				this.lastStatus = this.data[eventStartIndex];

				if (this.data[eventStartIndex] <= 0x8f) {
					// Note off
					eventJson.name = 'Note off';
					eventJson.noteNumber = this.data[eventStartIndex + 1];
					eventJson.noteName = Constants.NOTES[this.data[eventStartIndex + 1]];
					eventJson.velocity = Math.round(this.data[eventStartIndex + 2] / 127 * 100);
					this.pointer += deltaByteCount + 3;

				} else if (this.data[eventStartIndex] <= 0x9f) {
					// Note on
					eventJson.name = 'Note on';
					eventJson.noteNumber = this.data[eventStartIndex + 1];
					eventJson.noteName = Constants.NOTES[this.data[eventStartIndex + 1]];
					eventJson.velocity = Math.round(this.data[eventStartIndex + 2] / 127 * 100);
					this.pointer += deltaByteCount + 3;

				} else if (this.data[eventStartIndex] <= 0xaf) {
					// Polyphonic Key Pressure
					eventJson.name = 'Polyphonic Key Pressure';
					eventJson.note = Constants.NOTES[this.data[eventStartIndex + 1]];
					eventJson.pressure = event[2];
					this.pointer += deltaByteCount + 3;

				} else if (this.data[eventStartIndex] <= 0xbf) {
					// Controller Change
					eventJson.name = 'Controller Change';
					eventJson.number = this.data[eventStartIndex + 1];
					eventJson.value = this.data[eventStartIndex + 2];
					this.pointer += deltaByteCount + 3;

				} else if (this.data[eventStartIndex] <= 0xcf) {
					// Program Change
					eventJson.name = 'Program Change';
					this.pointer += deltaByteCount + 2;

				} else if (this.data[eventStartIndex] <= 0xdf) {
					// Channel Key Pressure
					eventJson.name = 'Channel Key Pressure';
					this.pointer += deltaByteCount + 2;

				} else if (this.data[eventStartIndex] <= 0xef) {
					// Pitch Bend
					eventJson.name = 'Pitch Bend';
					this.pointer += deltaByteCount + 3;

				} else {
					eventJson.name = 'Unknown.  Pointer: ' + this.pointer.toString() + ' '  + eventStartIndex.toString() + ' ' + this.data.length;
				}
			}
		}

		this.delta += eventJson.delta;
		this.events.push(eventJson);

		return eventJson;
	}

	endOfTrack() {
		if (this.data[this.pointer + 1] == 0xff && this.data[this.pointer + 2] == 0x2f && this.data[this.pointer + 3] == 0x00) {
			return true;
		}

		return false;
	}
}