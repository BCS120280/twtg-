/**
 * Filename             : decoder_vb_sitesync.js
 * Based on             : decoder_vb_rev-12.js
 * Modified for         : Sitesync compatibility with enhanced error handling
 *
 * This decoder includes:
 * - Auto-detection based on payload length
 * - Protocol version auto-correction
 * - Better error messages for debugging
 * - Sitesync-specific output format
 */

// Main entry point for Sitesync
function Decoder(bytes, port) {
  return decodeUplink({ fPort: port, bytes: bytes });
}

function decodeUplink(input) {
  var result = {
    data: {},
    warnings: [],
    errors: []
  };

  try {
    var bytes = input.bytes;
    var fPort = input.fPort;

    // Handle empty or null payloads
    if (!bytes || bytes.length === 0) {
      result.warnings.push("Empty payload received");
      return result;
    }

    // Get protocol version from first byte
    var detected_protocol = (bytes[0] >> 4) & 0x0F;
    var payload_length = bytes.length;

    // Auto-detect and correct protocol version based on payload length
    var corrected_info = auto_detect_message_type(bytes, fPort, detected_protocol, payload_length);

    if (corrected_info.warning) {
      result.warnings.push(corrected_info.warning);
    }

    // Decode using corrected information
    result.data = decode_message(bytes, corrected_info.fPort, corrected_info.protocol);

    // Add metadata (use flat keys for Sitesync compatibility)
    result.data["metaData/protocol_version"] = corrected_info.protocol;
    result.data["metaData/fPort"] = corrected_info.fPort;
    result.data["metaData/payload_length"] = payload_length;

  } catch (error) {
    result.errors.push(error.message);
    // Use flat keys for Sitesync compatibility
    result.data["Errors/decodeError"] = error.message;
    result.data["metaData/diagnostics/code"] = "4";
    result.data["metaData/diagnostics/raw_payload"] = bytes_to_hex(bytes);
  }

  return result;
}

/**
 * Auto-detect message type based on payload length and fPort
 */
function auto_detect_message_type(bytes, fPort, detected_protocol, length) {
  var result = {
    protocol: detected_protocol,
    fPort: fPort,
    warning: null
  };

  // Length-based detection for ambiguous cases
  switch (length) {
    case 3:
    case 35:
      // Protocol v3 Boot message lengths
      if (detected_protocol !== 3) {
        result.warning = "Payload length " + length + " suggests Protocol v3 Boot, but header indicates v" + detected_protocol + ". Auto-correcting to Protocol v3.";
        result.protocol = 3;
        result.fPort = 1; // FPORT_BOOT
      }
      break;

    case 11:
      // Protocol v3 Sensor Event (normal) length
      if (detected_protocol !== 3 || fPort !== 3) {
        result.warning = "Payload length " + length + " suggests Protocol v3 Sensor Event (normal), but header indicates v" + detected_protocol + " fPort=" + fPort + ". Auto-correcting to Protocol v3, fPort=3.";
        result.protocol = 3;
        result.fPort = 3; // FPORT_SENSOR_EVENT
      }
      break;

    case 45:
      // Could be Protocol v3 Sensor Event (extended) or v1/v2 Sensor Event
      if (detected_protocol === 3 && fPort !== 3) {
        result.warning = "Payload length " + length + " with Protocol v3 suggests Sensor Event. Setting fPort=3.";
        result.fPort = 3;
      }
      break;

    case 46:
      // Protocol v1/v2 Boot or Protocol v3 Sensor Data
      if (detected_protocol === 3 && fPort !== 4) {
        result.warning = "Payload length " + length + " with Protocol v3 suggests Sensor Data. Setting fPort=4.";
        result.fPort = 4;
      }
      break;

    case 9:
    case 12:
      // Protocol v3 Device Status lengths
      if (detected_protocol !== 3 || fPort !== 2) {
        result.warning = "Payload length " + length + " suggests Protocol v3 Device Status. Auto-correcting.";
        result.protocol = 3;
        result.fPort = 2; // FPORT_DEVICE_STATUS
      }
      break;

    case 8:
      // Protocol v3 Activation
      if (detected_protocol !== 3 || fPort !== 5) {
        result.warning = "Payload length " + length + " suggests Protocol v3 Activation. Auto-correcting.";
        result.protocol = 3;
        result.fPort = 5; // FPORT_ACTIVATION
      }
      break;
  }

  return result;
}

/**
 * Main decoder function (from original decoder)
 */
function decode_message(bytes, fPort, protocol_version) {
  // Protocol Versions
  var PROTOCOL_VERSION_V1 = 1;
  var PROTOCOL_VERSION_V2 = 2;
  var PROTOCOL_VERSION_V3 = 3;

  // Message Ports
  var FPORT_BOOT = 1;
  var FPORT_DEVICE_STATUS = 2;
  var FPORT_SENSOR_EVENT = 3;
  var FPORT_SENSOR_DATA = 4;
  var FPORT_ACTIVATION = 5;
  var FPORT_DEACTIVATION = 6;
  var FPORT_CONFIG_UPDATE = 7;

  var decoded = {};
  var cursor = { value: 0 };

  switch (protocol_version) {
    case PROTOCOL_VERSION_V1:
    case PROTOCOL_VERSION_V2:
      decoded.header = decode_header(bytes, cursor);
      switch (decoded.header.message_type) {
        case "boot":
          decoded.boot = decode_boot_msg(bytes, cursor);
          break;
        case "activated":
          decoded.activated = decode_activated_msg(bytes, cursor);
          break;
        case "deactivated":
          decoded.deactivated = decode_deactivated_msg(bytes, cursor);
          break;
        case "sensor_event":
          decoded.sensor_event = decode_sensor_event_msg(bytes, cursor);
          break;
        case "device_status":
          decoded.device_status = decode_device_status_msg(bytes, cursor);
          break;
        case "sensor_data":
          decoded.sensor_data = decode_sensor_data_msg(bytes, cursor, decoded.header.protocol_version);
          break;
        default:
          throw new Error("Invalid message type: " + decoded.header.message_type);
      }
      break;

    case PROTOCOL_VERSION_V3:
      switch (fPort) {
        case FPORT_BOOT:
          header = decode_header_v3(bytes, cursor);
          decoded.boot = decode_boot_msg_v3(bytes, cursor);
          decoded.boot.protocol_version = header.protocol_version;
          break;

        case FPORT_DEVICE_STATUS:
          header = decode_header_v3(bytes, cursor);
          decoded.device_status = decode_device_status_msg_v3(bytes, cursor);
          decoded.device_status.protocol_version = header.protocol_version;
          break;

        case FPORT_SENSOR_EVENT:
          header = decode_header_v3(bytes, cursor);
          decoded.sensor_event = decode_sensor_event_msg_v3(bytes, cursor);
          decoded.sensor_event.protocol_version = header.protocol_version;
          break;

        case FPORT_SENSOR_DATA:
          header = decode_header_v3(bytes, cursor);
          decoded.sensor_data = decode_sensor_data_msg(bytes, cursor, header.protocol_version);
          decoded.sensor_data.protocol_version = header.protocol_version;
          break;

        case FPORT_ACTIVATION:
          header = decode_header_v3(bytes, cursor);
          decoded.activated = decode_activated_msg_v3(bytes, cursor);
          decoded.activated.protocol_version = header.protocol_version;
          break;

        case FPORT_DEACTIVATION:
          header = decode_header_v3(bytes, cursor);
          decoded.deactivated = decode_deactivated_msg(bytes, cursor);
          decoded.deactivated.protocol_version = header.protocol_version;
          break;

        case FPORT_CONFIG_UPDATE:
          decoded.config_update_ans = decode_config_update_ans_msg(bytes, cursor);
          break;

        default:
          throw new Error("Unsupported fPort: " + fPort + " for Protocol v3");
      }
      break;

    default:
      throw new Error("Unsupported protocol version: " + protocol_version);
  }

  return decoded;
}

/******************
 * Helper functions
 */

function bytes_to_hex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    hex += uint8_to_hex(bytes[i]);
  }
  return hex;
}

function decode_header(bytes, cursor) {
  var header = {};
  var data = decode_uint8(bytes, cursor);
  header.protocol_version = data >> 4;
  header.message_type = message_type_lookup(data & 0x0F);
  return header;
}

function decode_header_v3(bytes, cursor) {
  var header = {};
  var data = decode_uint8(bytes, cursor);
  header.protocol_version = data >> 4;
  return header;
}

function decode_uint8(bytes, cursor) {
  var result = bytes[cursor.value];
  cursor.value += 1;
  return result;
}

function decode_uint16(bytes, cursor) {
  var result = 0;
  var i = cursor.value + 1;
  result = bytes[i--];
  result = result * 256 + bytes[i--];
  cursor.value += 2;
  return result;
}

function decode_int16(bytes, cursor) {
  var result = 0;
  var i = cursor.value + 1;
  if (bytes[i] & 0x80) {
    result = 0xFFFF;
  }
  result = (result << 8) | bytes[i--];
  result = (result << 8) | bytes[i--];
  cursor.value += 2;
  return result;
}

function decode_uint32(bytes, cursor) {
  var result = 0;
  var i = cursor.value + 3;
  result = bytes[i--];
  result = result * 256 + bytes[i--];
  result = result * 256 + bytes[i--];
  result = result * 256 + bytes[i--];
  cursor.value += 4;
  return result;
}

function decode_int8(bytes, cursor) {
  var result = 0;
  var i = cursor.value;
  if (bytes[i] & 0x80) {
    result = 0xFFFFFF;
  }
  result = (result << 8) | bytes[i--];
  cursor.value += 1;
  return result;
}

function uint8_to_hex(d) {
  return ('0' + (Number(d).toString(16).toUpperCase())).slice(-2);
}

function uint16_to_hex(d) {
  return ('000' + (Number(d).toString(16).toUpperCase())).slice(-4);
}

function uint32_to_hex(d) {
  return ('0000000' + (Number(d).toString(16).toUpperCase())).slice(-8);
}

function message_type_lookup(type_id) {
  var type_names = ["boot", "activated", "deactivated", "sensor_event", "device_status",
    "base_configuration", "sensor_configuration", "sensor_data_configuration", "sensor_data"];
  if (type_id < type_names.length) {
    return type_names[type_id];
  }
  return "unknown";
}

function lookup_selection(selection) {
  switch (selection) {
    case 0: return "extended";
    case 1: return "min_only";
    case 2: return "max_only";
    case 3: return "avg_only";
    default: return "unknown";
  }
}

function lookup_trigger(trigger) {
  switch (trigger) {
    case 0: return "condition change";
    case 1: return "periodic";
    case 2: return "button press";
    default: return "unknown";
  }
}

function reboot_lookup_major(reboot_reason) {
  var major_reboot_reason = reboot_reason & 0x0F;
  switch (major_reboot_reason) {
    case 0: return "none";
    case 1: return "config update";
    case 2: return "firmware update";
    case 3: return "button reset";
    case 4: return "power";
    case 5: return "communication failure";
    default: return "system failure";
  }
}

function reboot_lookup_minor(reboot_reason) {
  var major_reboot_reason = reboot_reason & 0x0F;
  var minor_reboot_reason = (reboot_reason >> 4) & 0x0F;

  switch (major_reboot_reason) {
    case 0:
    case 1:
    case 3:
    case 5:
    case 6:
      return "";
    case 2:
      switch (minor_reboot_reason) {
        case 0: return "success";
        case 1: return "rejected";
        case 2: return "error";
        case 3: return "in progress";
        default: return "unknown";
      }
    case 4:
      switch (minor_reboot_reason) {
        case 0: return "black out";
        case 1: return "brown out";
        case 2: return "power safe state";
        default: return "unknown";
      }
    default:
      return "unknown";
  }
}

function decode_battery_voltage(bytes, cursor) {
  var raw = decode_uint8(bytes, cursor);
  var offset = 2;
  var scale = 2 / 255;
  return raw * scale + offset;
}

function rssi_lookup(rssi) {
  switch (rssi) {
    case 0: return "0..-79";
    case 1: return "-80..-99";
    case 2: return "-100..-129";
    case 3: return "<-129";
    default: return "unknown";
  }
}

/***************************
 * Message decoder functions
 */

function decode_boot_msg(bytes, cursor) {
  throw new Error("Protocol v1/v2 Boot messages not fully implemented in Sitesync decoder. Use Protocol v3.");
}

function decode_boot_msg_v3(bytes, cursor) {
  var expected_length_normal = 3;
  var expected_length_debug = 35;

  if (bytes.length != expected_length_normal && bytes.length != expected_length_debug) {
    throw new Error("Invalid boot message length " + bytes.length + " (expected " + expected_length_normal + " or " + expected_length_debug + ")");
  }

  var boot = {};
  boot.base = {};
  boot.sensor = {};

  var base_reboot_reason = decode_uint8(bytes, cursor);
  boot.base.reboot_reason = {};
  boot.base.reboot_reason.major = reboot_lookup_major(base_reboot_reason);
  boot.base.reboot_reason.minor = reboot_lookup_minor(base_reboot_reason);

  var sensor_reboot_reason = decode_uint8(bytes, cursor);
  boot.sensor.reboot_reason = {};
  boot.sensor.reboot_reason.major = reboot_lookup_major(sensor_reboot_reason);
  boot.sensor.reboot_reason.minor = reboot_lookup_minor(sensor_reboot_reason);

  if (bytes.length == expected_length_debug) {
    boot.debug = '0x';
    for (var i = cursor.value; i < bytes.length; i++) {
      boot.debug += uint8_to_hex(bytes[i]);
    }
  }

  return boot;
}

function decode_activated_msg(bytes, cursor) {
  throw new Error("Protocol v1/v2 Activated messages not fully implemented. Use Protocol v3.");
}

function decode_activated_msg_v3(bytes, cursor) {
  var expected_length = 8;
  if (bytes.length != expected_length) {
    throw new Error("Invalid activated message length " + bytes.length + " (expected " + expected_length + ")");
  }

  var activated = {};
  activated.sensor = {};
  activated.sensor.device_type = device_types_lookup(decode_uint8(bytes, cursor));
  activated.sensor.device_id = decode_device_id(bytes, cursor);
  activated.base = {};
  activated.base.device_type = device_types_lookup(decode_uint8(bytes, cursor));

  return activated;
}

function decode_deactivated_msg(bytes, cursor) {
  var expected_length = 3;
  if (bytes.length != expected_length) {
    throw new Error("Invalid deactivated message length " + bytes.length + " (expected " + expected_length + ")");
  }

  var deactivated = {};
  var reason = decode_uint8(bytes, cursor);
  deactivated.reason = deactivation_reason_lookup(reason);
  var reason_length = decode_uint8(bytes, cursor);

  if (reason_length != 0) {
    throw new Error("Unsupported deactivated reason length");
  }

  return deactivated;
}

function deactivation_reason_lookup(deactivation_id) {
  switch (deactivation_id) {
    case 0: return "user_triggered";
    case 1: return "activation_user_timeout";
    case 2: return "activation_sensor_comm_fail";
    case 3: return "activation_sensor_meas_fail";
    default: return "unknown";
  }
}

function decode_device_id(bytes, cursor) {
  var prefix = decode_uint8(bytes, cursor).toString();
  var serial = pad(decode_uint32(bytes, cursor), 10);
  return prefix + "-" + serial;
}

function pad(num, size) {
  num = num.toString();
  while (num.length < size) num = "0" + num;
  return num;
}

function device_types_lookup(type_id) {
  var type_names = ["", "ts", "vs-qt", "vs-mt", "tt", "ld", "vb"];
  if (type_id < type_names.length) {
    return type_names[type_id];
  }
  return "unknown";
}

function decode_sensor_event_msg(bytes, cursor) {
  throw new Error("Protocol v1/v2 Sensor Event messages not fully implemented. Use Protocol v3.");
}

function decode_sensor_event_msg_v3(bytes, cursor) {
  var expected_length_normal = 11;
  var expected_length_extended = 45;

  if (bytes.length == expected_length_normal) {
    return decode_sensor_event_msg_normal(bytes, cursor);
  } else if (bytes.length == expected_length_extended) {
    return decode_sensor_event_msg_extended(bytes, cursor);
  } else {
    throw new Error("Invalid sensor_event message length " + bytes.length + " (expected " + expected_length_normal + " or " + expected_length_extended + ")");
  }
}

function decode_sensor_event_msg_normal(bytes, cursor) {
  var sensor_event = {};

  var selection_byte = decode_uint8(bytes, cursor);

  // Handle both standard format (full byte) and variant format (bits 0-1 only)
  // Some firmware versions may set additional bits in the selection byte
  var selection = selection_byte & 0x03;  // Use only bits 0-1 for selection

  sensor_event.selection = lookup_selection(selection);

  // Warn if extra bits are set (possible firmware variant)
  if (selection_byte > 3) {
    sensor_event.selection_raw = selection_byte;
    sensor_event.selection_note = "Extra bits detected in selection byte (0x" +
      uint8_to_hex(selection_byte) + "), using bits 0-1 only";
  }

  if (sensor_event.selection == "extended") {
    throw new Error("Mismatch: extended flag set but message length is normal (11 bytes)");
  }

  var conditions = decode_uint8(bytes, cursor);
  sensor_event.condition_0 = (conditions & 1);
  sensor_event.condition_1 = ((conditions >> 1) & 1);
  sensor_event.condition_2 = ((conditions >> 2) & 1);
  sensor_event.condition_3 = ((conditions >> 3) & 1);
  sensor_event.condition_4 = ((conditions >> 4) & 1);
  sensor_event.trigger = lookup_trigger((conditions >> 6) & 3);

  var x = decode_uint16(bytes, cursor) / 100;
  var y = decode_uint16(bytes, cursor) / 100;
  var z = decode_uint16(bytes, cursor) / 100;
  var temperature = decode_int16(bytes, cursor) / 100;

  sensor_event.rms_velocity = {};
  sensor_event.temperature = {};

  if (sensor_event.selection == "min_only") {
    sensor_event.rms_velocity = { x: { min: x }, y: { min: y }, z: { min: z } };
    sensor_event.temperature = { min: temperature };
  } else if (sensor_event.selection == "max_only") {
    sensor_event.rms_velocity = { x: { max: x }, y: { max: y }, z: { max: z } };
    sensor_event.temperature = { max: temperature };
  } else if (sensor_event.selection == "avg_only") {
    sensor_event.rms_velocity = { x: { avg: x }, y: { avg: y }, z: { avg: z } };
    sensor_event.temperature = { avg: temperature };
  } else {
    throw new Error("Invalid selection: " + sensor_event.selection);
  }

  return sensor_event;
}

function decode_sensor_event_msg_extended(bytes, cursor) {
  var sensor_event = {};

  var selection = decode_uint8(bytes, cursor);
  sensor_event.selection = lookup_selection(selection);

  if (sensor_event.selection != "extended") {
    throw new Error("Mismatch: non-extended flag but message length is extended (45 bytes)");
  }

  var conditions = decode_uint8(bytes, cursor);
  sensor_event.condition_0 = (conditions & 1);
  sensor_event.condition_1 = ((conditions >> 1) & 1);
  sensor_event.condition_2 = ((conditions >> 2) & 1);
  sensor_event.condition_3 = ((conditions >> 3) & 1);
  sensor_event.condition_4 = ((conditions >> 4) & 1);
  sensor_event.trigger = lookup_trigger((conditions >> 6) & 3);

  sensor_event.rms_velocity = {};
  sensor_event.rms_velocity.x = {
    min: decode_velocity_v3(bytes, cursor),
    max: decode_velocity_v3(bytes, cursor),
    avg: decode_velocity_v3(bytes, cursor)
  };
  sensor_event.rms_velocity.y = {
    min: decode_velocity_v3(bytes, cursor),
    max: decode_velocity_v3(bytes, cursor),
    avg: decode_velocity_v3(bytes, cursor)
  };
  sensor_event.rms_velocity.z = {
    min: decode_velocity_v3(bytes, cursor),
    max: decode_velocity_v3(bytes, cursor),
    avg: decode_velocity_v3(bytes, cursor)
  };

  sensor_event.acceleration = {};
  sensor_event.acceleration.x = {
    min: decode_acceleration_v3(bytes, cursor),
    peak: decode_acceleration_v3(bytes, cursor),
    rms: decode_acceleration_v3(bytes, cursor)
  };
  sensor_event.acceleration.y = {
    min: decode_acceleration_v3(bytes, cursor),
    peak: decode_acceleration_v3(bytes, cursor),
    rms: decode_acceleration_v3(bytes, cursor)
  };
  sensor_event.acceleration.z = {
    min: decode_acceleration_v3(bytes, cursor),
    peak: decode_acceleration_v3(bytes, cursor),
    rms: decode_acceleration_v3(bytes, cursor)
  };

  sensor_event.temperature = {
    min: decode_temperature_v3(bytes, cursor),
    max: decode_temperature_v3(bytes, cursor),
    avg: decode_temperature_v3(bytes, cursor)
  };

  return sensor_event;
}

function decode_velocity_v3(bytes, cursor) {
  return decode_uint16(bytes, cursor) / 100;
}

function decode_acceleration_v3(bytes, cursor) {
  return decode_int16(bytes, cursor) / 100;
}

function decode_temperature_v3(bytes, cursor) {
  return decode_int16(bytes, cursor) / 100;
}

function decode_device_status_msg(bytes, cursor) {
  throw new Error("Protocol v1/v2 Device Status messages not fully implemented. Use Protocol v3.");
}

function decode_device_status_msg_v3(bytes, cursor) {
  var expected_length_normal = 9;
  var expected_length_debug = 12;

  if (bytes.length != expected_length_normal && bytes.length != expected_length_debug) {
    throw new Error("Invalid device status message length " + bytes.length + " (expected " + expected_length_normal + " or " + expected_length_debug + ")");
  }

  var device_status = {};
  device_status.base = {};
  device_status.sensor = {};

  device_status.base.battery_voltage = decode_battery_voltage(bytes, cursor);
  device_status.base.temperature = decode_int8(bytes, cursor);
  device_status.base.lora_tx_counter = decode_uint16(bytes, cursor);

  var rssi = decode_uint8(bytes, cursor);
  device_status.base.avg_rssi = rssi_lookup(rssi);

  var bist = decode_uint8(bytes, cursor);
  device_status.base.bist = '0x' + uint8_to_hex(bist);

  device_status.sensor.event_counter = decode_uint8(bytes, cursor);

  bist = decode_uint8(bytes, cursor);
  device_status.sensor.bist = '0x' + uint8_to_hex(bist);

  if (bytes.length == expected_length_debug) {
    device_status.debug = '0x';
    for (var i = cursor.value; i < bytes.length; i++) {
      device_status.debug += uint8_to_hex(bytes[i]);
    }
  }

  return device_status;
}

function decode_sensor_data_msg(bytes, cursor, protocol_version) {
  var sensor_data = {};
  var expected_length = 46;

  if (bytes.length != expected_length) {
    throw new Error("Invalid sensor_data message length " + bytes.length + " (expected " + expected_length + ")");
  }

  var fix_freq_offset = 0;
  var binToHzFactor, chunk_size, data_offset;

  if (protocol_version == 3) {
    var obj = decode_sensor_data_config_v3(bytes, cursor);
    sensor_data.config = obj.result;
    binToHzFactor = obj.binToHzFactor;
    chunk_size = 39;
    data_offset = 7;
  } else {
    sensor_data.config = decode_sensor_data_config(bytes, cursor, protocol_version);
    binToHzFactor = 1.62762;
    chunk_size = 40;
    data_offset = 6;
    if (sensor_data.config.unit == "acceleration") {
      fix_freq_offset = Math.min(2, sensor_data.config.start_frequency);
    }
  }

  sensor_data.raw = bytes.slice(data_offset);
  sensor_data.frequency = [];
  sensor_data.magnitude = [];

  var deltaF = sensor_data.config.spectral_line_frequency * binToHzFactor;
  var frequency_offset = (sensor_data.config.start_frequency - fix_freq_offset) * deltaF;
  frequency_offset += sensor_data.config.frame_number * chunk_size * deltaF;

  for (var i = 0; i < chunk_size; i++) {
    sensor_data.frequency[i] = frequency_offset + i * deltaF;
    sensor_data.magnitude[i] = sensor_data.raw[i] * sensor_data.config.scale / 255;
  }

  return sensor_data;
}

function decode_sensor_data_config(bytes, cursor, protocol_version) {
  var config = decode_uint32(bytes, cursor);
  var result = {};

  result.frame_number = config & 0xFF;
  result.sequence_number = (config >> 8) & 0x03;

  switch ((config >> 10) & 0x3) {
    case 0: result.axis = "x"; break;
    case 1: result.axis = "y"; break;
    case 2: result.axis = "z"; break;
    default: throw new Error("Invalid axis in sensor data config");
  }

  result.unit = ((config >> 12) & 0x1) ? "acceleration" : "velocity";

  if (protocol_version == 2) {
    var scale_coefficient = ((config >> 13) & 0x0F);
    if (scale_coefficient < 1 || scale_coefficient > 15) {
      throw new Error("Invalid scale coefficient");
    }
    var scale_power = ((config >> 17) & 0x03) - 2;
    result.scale = scale_coefficient * Math.pow(10, scale_power);
  } else {
    result.scale = ((config >> 13) & 0x3F) * 4;
    if (result.scale == 0) {
      throw new Error("Invalid scale value");
    }
  }

  result.start_frequency = config >>> 19;
  if (result.start_frequency > 8191) {
    throw new Error("Invalid start_frequency");
  }

  result.spectral_line_frequency = decode_uint8(bytes, cursor);
  if (result.spectral_line_frequency == 0) {
    throw new Error("Invalid spectral_line_frequency");
  }

  return result;
}

function decode_sensor_data_config_v3(bytes, cursor) {
  var result = {};

  result.frame_number = decode_uint8(bytes, cursor);
  var b = decode_uint8(bytes, cursor);

  result.sequence_number = b & 0x03;

  switch ((b >> 2) & 0x3) {
    case 0: result.axis = "x"; break;
    case 1: result.axis = "y"; break;
    case 2: result.axis = "z"; break;
    default: throw new Error("Invalid axis");
  }

  var binToHzFactor;
  if ((b >> 4) & 0x1) {
    result.resolution = "high_res";
    binToHzFactor = 0.8138;
  } else {
    result.resolution = "low_res";
    binToHzFactor = 1.62762;
  }

  result.unit = ((b >> 5) & 0x1) ? "acceleration" : "velocity";

  result.start_frequency = decode_uint16(bytes, cursor);
  if (result.start_frequency > 8191) {
    throw new Error("Invalid start_frequency");
  }

  result.spectral_line_frequency = decode_uint8(bytes, cursor);
  if (result.spectral_line_frequency == 0) {
    throw new Error("Invalid spectral_line_frequency");
  }

  result.scale = data_scale_lookup(decode_uint8(bytes, cursor));

  return { result: result, binToHzFactor: binToHzFactor };
}

function data_scale_lookup(scale_idx) {
  var scale_value = [0.0100000000000000, 0.0108175019990394, 0.0117018349499221, 0.0126584622963211, 0.0136932941195217, 0.0148127236511360, 0.0160236667707382, 0.0173336047324401, 0.0187506303843729, 0.0202834981666202, 0.0219416781964925, 0.0237354147752836, 0.0256757896779659, 0.0277747906168310, 0.0300453853020469, 0.0325016015566801, 0.0351586139811367, 0.0380328377024400, 0.0411420297875284, 0.0445053989471126, 0.0481437242078435, 0.0520794832859547, 0.0563369914554751, 0.0609425517689466, 0.0659246175587139, 0.0713139682227294, 0.0771438993808804, 0.0834504285766365, 0.0902725177948457, 0.0976523141704060, 0.105635410374919, 0.114271126290003, 0.123612813707458, 0.133718185938731, 0.144649674370014, 0.156474814165802, 0.169266661503788, 0.183104244918794, 0.198073053544165, 0.214265565266983, 0.231781818060089, 0.250730028020599, 0.271227257933203, 0.293400140488639, 0.317385660625428, 0.343332001828200, 0.371399461611073, 0.401761441841993, 0.434605520026269, 0.470134608167771, 0.508568206367245, 0.550143758902554, 0.595118121168740, 0.643769146540740, 0.696397402962432, 0.753328029867193, 0.814912746902074, 0.881532026865585, 0.953597446283568, 1.03155422814513, 1.11588399250775, 1.20710773196486, 1.30578903035857, 1.41253754462275, 1.52801277126748, 1.65292812077436, 1.78805532507451, 1.93422920533864, 2.09235282953511, 2.26340309161917, 2.44843674682223, 2.64859694032709, 2.86512026966378, 3.09934442445761, 3.35271645072817, 3.62680169079642, 3.92329345403096, 4.24402347817979, 4.59097324591799, 4.96628622652541, 5.37228111832403, 5.81146617368716, 6.28655469512105, 6.80048179815422, 7.35642254459641, 7.95781155819499, 8.60836424387529, 9.31209974165798, 10.0733657570639, 10.8968654214094, 11.7876863479359, 12.7513320632845, 13.7937560084995, 14.9213983196205, 16.1412256150957, 17.4607740358243, 18.8881958037304, 20.4323095865101, 22.1026549797064, 23.9095514427051, 25.8641620527597, 27.9785624709206, 30.2658155459431, 32.7400520170796, 35.4165578143412, 38.3118684955729, 41.4438714037792, 44.8319161758313, 48.4969342852820, 52.4615683578319, 56.7503120583586, 61.3896614137401, 66.4082785063484, 71.8371685495186, 77.7098714389746, 84.0626689636199, 90.9348089558542, 98.3687477662216, 106.410412560410, 115.109485059084, 124.519708473503, 134.699219533192, 145.710907656935, 157.622803486073, 170.508499180478, 184.447603073803, 199.526231496888];

  if (scale_idx >= 127) {
    throw new Error("Invalid scale index: " + scale_idx);
  }

  return scale_value[scale_idx];
}

function decode_config_update_ans_msg(bytes, cursor) {
  var expected_length = 6;
  if (bytes.length != expected_length) {
    throw new Error("Invalid config update ans message length " + bytes.length + " (expected " + expected_length + ")");
  }

  var ans = {};
  ans = decode_config_header(bytes, cursor);

  var tag = decode_uint32(bytes, cursor);
  ans.tag = '0x' + uint32_to_hex(tag);

  var counter = decode_uint8(bytes, cursor);
  ans.counter = counter & 0x0F;

  return ans;
}

function decode_config_header(bytes, cursor) {
  var header = {};
  var data = decode_uint8(bytes, cursor);
  header.protocol_version = data >> 4;
  header.config_type = config_type_lookup(data & 0x0F);
  return header;
}

function config_type_lookup(type_id) {
  var type_names = ["base", "region", "reserved", "sensor", "sensor_data", "sensor_conditions"];
  if (type_id < type_names.length) {
    return type_names[type_id];
  }
  return "unknown";
}

// Export for Node.js and browser compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Decoder: Decoder,
    decodeUplink: decodeUplink
  };
}
