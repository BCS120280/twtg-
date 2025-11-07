/**
 * Filename             : decoder_vb_rev-12.js
 * Latest commit        : 1a72fc2f1
 * Protocol v2 document : 6013_P20-002_Communication-Protocol-NEON-Vibration-Sensor_E.pdf
 * Protocol v3 document : NEON-Vibration-Sensor_Communication-Protocol-v3_DS-VB-xx-xx_6013_3_A2.pdf
 *
 * Release History
 *
 * 2021-04-14 revision 0
 * - initial version
 *
 * 2021-03-05 revision 1
 * - using scientific notation for sensor data scale
 *
 * 2021-05-14 revision 2
 * - made it compatible with v1 and v2 (merged in protocol v1)
 * - added DecodeHexString to directly decode from HEX string
 *
 * 2021-07-15 revision 3
 * - Verify message length with expected_length before parsing
 *
 * 2021-10-27 revision 4
 * - Fixed range check of start_frequency
 *
 * 2022-10-19 revision 5
 * - Protocol V3
 * -- Updated Boot, Device status, and Sensor event messages to support normal, extended, debug formats.
 * -- Removed message_type from header.
 * -- Added configUpdateAns.
 * -- Separated the sensor configuration into Sensor configuration and sensor conditions configuration
 * -- Separated base configuration into base configuration and Region configuration
 * -- Moved protocol_version into message body
 * -- Ignore null payload OR MAC uplink
 * -- Added entry point for ThingPark
 *
 * 2022-11-10 revision 6
 * - Removed 5th condition
 * - Used throw new Error instead of throw
 * - For normal event message include selection in structure
 *
 * 2022-11-22 revision 7
 * - Updated scale and added resolution in sensor data message
 * -- scale is now defined as index of a lookup table
 * -- resolution indicates if it is in either low or high resolution
 *
 * 2022-12-01 revision 8
 * - Added resolution to sensor data
 * - Added decoder for TS006 DevVersion
 * - Changed "acceleration.avg" to "acceleration.rms" in sensor event
 * - Changed "acceleration.max" to "acceleration.peak" in sensor event
 * - Removed minor reboot reason config
 *
 * 2023-12-12 revision 9
 * - For protocol v3, the frequency axis is calculated based on the resolution in sensor data message
 * - Added support of LoRaWAN Payload Codec API Specification (TS013-1.0.0)
 *
 * 2024-04-05 revision 10
 * - Fixed issue where spectral_line_frequency in sensor data message was not accounted for in frequency offset calculation.
 *
 * 2024-06-11 revision 11
 * - Fixed issue where start_frequency was calculated using starting line, instead of starting bin.
 *
 * 2024-08-30 revision 12
 * - Reverted changes from revision 11
 * - Fixed issue where v2 has a magic offset in the firmware for acceleration data, which is incorrect (fix_freq_offset).
 *
 * YYYY-MM-DD revision X
 *
 */

if (typeof module !== 'undefined') {
    // Only needed for nodejs
    module.exports = {
      decodeUplink: decodeUplink,
      Decode: Decode,
      Decoder: Decoder,
      DecodeHexString: DecodeHexString,
      DecodeRebootInfo: DecodeRebootInfo,
      decode_float: decode_float,
      decode_uint32: decode_uint32,
      decode_int32: decode_int32,
      decode_uint16: decode_uint16,
      decode_int16: decode_int16,
      decode_uint8: decode_uint8,
      decode_int8: decode_int8,
      decode_device_id: decode_device_id,
      decode_reboot_info: decode_reboot_info,
      decode_battery_voltage: decode_battery_voltage,
      decode_sensor_data_config: decode_sensor_data_config,
      decode_sensor_data_config_v3: decode_sensor_data_config_v3,
      from_hex_string: from_hex_string,
      decode_velocity_v3: decode_velocity_v3,
      decode_acceleration_v3: decode_acceleration_v3,
      decode_temperature_v3: decode_temperature_v3
    };
  }

  /**
   * LoRaWAN Payload Codec API Specification (TS013-1.0.0)
   */
  function decodeUplink(input) {
    var result = {};
    try {
      result.data = Decode(input.fPort, input.bytes);
    } catch (error) {
      result.errors = [error.message];
    }
    return result;
  }

  /**
   * Decoder for Chirpstack (loraserver) network server
   *
   * Decode an uplink message from a buffer
   * (array) of bytes to an object of fields.
   */
  function Decode(fPort, bytes) { // Used for ChirpStack (aka LoRa Network Server)

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
    var FPORT_CALIBRATION_UPDATE = 8;
    var FPORT_DEFAULT_APP = 15;

    // Message headers strings
    var STR_BOOT = "boot";
    var STR_ACTIVATED = "activated";
    var STR_DEACTIVATED = "deactivated";
    var STR_SENSOR_EVENT = "sensor_event";
    var STR_DEVICE_STATUS = "device_status";
    var STR_SENSOR_DATA = "sensor_data";

    var decoded = {};

    if (fPort == 0 || bytes.length == 0) {
      // Ignore null payload OR MAC uplink
      return decoded;
    }

    // Handle generic LoRaWAN specified messages
    if (handle_generic_messages(fPort, bytes, decoded)) {
      return decoded;
    }

    var cursor = {};   // keeping track of which byte to process.
    cursor.value = 0;  // Start from 0
    var protocol_version = get_protocol_version(bytes);

    switch (protocol_version) {
      case PROTOCOL_VERSION_V1:
      case PROTOCOL_VERSION_V2:
        decoded.header = decode_header(bytes, cursor);
        switch (decoded.header.message_type) {
          case STR_BOOT:
            decoded.boot = decode_boot_msg(bytes, cursor);
            break;

          case STR_ACTIVATED:
            decoded.activated = decode_activated_msg(bytes, cursor);
            break;

          case STR_DEACTIVATED:
            decoded.deactivated = decode_deactivated_msg(bytes, cursor);
            break;

          case STR_SENSOR_EVENT:
            decoded.sensor_event = decode_sensor_event_msg(bytes, cursor);
            break;

          case STR_DEVICE_STATUS:
            decoded.device_status = decode_device_status_msg(bytes, cursor);
            break;

          case STR_SENSOR_DATA:
            decoded.sensor_data = decode_sensor_data_msg(bytes, cursor, decoded.header.protocol_version);
            break;

          default:
            throw new Error("Invalid message type!");
        }
        break;

      case PROTOCOL_VERSION_V3:
        // Protocol V3 reserves each fPort for different purpose
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

          case FPORT_CALIBRATION_UPDATE:
            // TODO: Implement this
            break;

          default:
            // NOTE: It could be unsupported device management message so there should be no assertion!
            break;
        }
        break;

      default:
        throw new Error("Unsupported protocol version!");
    };

    return decoded;
  }


  /**
   * Decoder for reboot payload
   *
   */
  function DecodeRebootInfo(reboot_type, bytes) {
    var cursor = {};   // keeping track of which byte to process.
    cursor.value = 0;  // skip header that has been checked

    return decode_reboot_info(reboot_type, bytes, cursor);
  }

  // Decoder for Actility and The Things Network (Compact Version with Little-Endian Fix)
  function Decoder(bytes, port)
  {
    // --- helpers (scoped inside Decoder) - LITTLE-ENDIAN byte order ---
    function readU8(b,c){var r=b[c.i];c.i++;return r;}
    function readI8(b,c){var v=b[c.i];c.i++;return (v&0x80)?(v-256):v;}
    function readU16(b,c){var i=c.i;var r=b[i]|(b[i+1]<<8);c.i+=2;return r;} // LITTLE-ENDIAN
    function readI16(b,c){var v=readU16(b,c);return (v&0x8000)?(v-0x10000):v;}
    function readU32(b,c){var i=c.i;var r=b[i]|(b[i+1]<<8)|(b[i+2]<<16)|(b[i+3]<<24);c.i+=4;return (r>>>0);} // LITTLE-ENDIAN
    function hex2(v,n){return ("00000000"+v.toString(16).toUpperCase()).slice(-n);}
    function toHexStr(arr){var s="";for(var i=0;i<arr.length;i++)s+=hex2(arr[i],2);return s;}
    function trigName(t){return t===0?"condition change":t===1?"periodic":t===2?"button press":"unknown";}
    function selName(s){return s===0?"extended":s===1?"min_only":s===2?"max_only":s===3?"avg_only":"unknown";}
    function rssiBucket(r){return r===0?"0..-79":r===1?"-80..-99":r===2?"-100..-129":r===3?"<-129":"unknown";}
    function battV(b,c){var raw=readU8(b,c);return 2+(raw*(2/255));}
    function cToF(c){return (c*9/5)+32;}

    // scale LUT (kept for completeness)
    function dataScale(idx){
      var v=[0.01,0.0108175019990394,0.0117018349499221,0.0126584622963211,0.0136932941195217,0.014812723651136,0.0160236667707382,0.0173336047324401,0.0187506303843729,0.0202834981666202,0.0219416781964925,0.0237354147752836,0.0256757896779659,0.027774790616831,0.0300453853020469,0.0325016015566801,0.0351586139811367,0.03803283770244,0.0411420297875284,0.0445053989471126,0.0481437242078435,0.0520794832859547,0.0563369914554751,0.0609425517689466,0.0659246175587139,0.0713139682227294,0.0771438993808804,0.0834504285766365,0.0902725177948457,0.097652314170406,0.105635410374919,0.114271126290003,0.123612813707458,0.133718185938731,0.144649674370014,0.156474814165802,0.169266661503788,0.183104244918794,0.198073053544165,0.214265565266983,0.231781818060089,0.250730028020599,0.271227257933203,0.293400140488639,0.317385660625428,0.3433320018282,0.371399461611073,0.401761441841993,0.434605520026269,0.470134608167771,0.508568206367245,0.550143758902554,0.59511812116874,0.64376914654074,0.696397402962432,0.753328029867193,0.814912746902074,0.881532026865585,0.953597446283568,1.03155422814513,1.11588399250775,1.20710773196486,1.30578903035857,1.41253754462275,1.52801277126748,1.65292812077436,1.78805532507451,1.93422920533864,2.09235282953511,2.26340309161917,2.44843674682223,2.64859694032709,2.86512026966378,3.09934442445761,3.35271645072817,3.62680169079642,3.92329345403096,4.24402347817979,4.59097324591799,4.96628622652541,5.37228111832403,5.81146617368716,6.28655469512105,6.80048179815422,7.35642254459641,7.95781155819499,8.60836424387529,9.31209974165798,10.0733657570639,10.8968654214094,11.7876863479359,12.7513320632845,13.7937560084995,14.9213983196205,16.1412256150957,17.4607740358243,18.8881958037304,20.4323095865101,22.1026549797064,23.9095514427051,25.8641620527597,27.9785624709206,30.2658155459431,32.7400520170796,35.4165578143412,38.3118684955729,41.4438714037792,44.8319161758313,48.496934285282,52.4615683578319,56.7503120583586,61.3896614137401,66.4082785063484,71.8371685495186,77.7098714389746,84.0626689636199,90.9348089558542,98.3687477662216,106.41041256041,115.109485059084,124.519708473503,134.699219533192,145.710907656935,157.622803486073,170.508499180478,184.447603073803,199.526231496888];
      if(idx>=127)throw new Error("Invalid scale index in sensor data config!");return v[idx];
    }

    // v3 FFT config (kept for completeness)
    function parseConfigV3(b,c){
      var cfg={}, binToHz;
      cfg.frame_number=readU8(b,c);
      var m=readU8(b,c);
      cfg.sequence_number=(m&0x03);
      var ax=(m>>2)&3; cfg.axis=ax===0?"x":ax===1?"y":ax===2?"z":"?";
      if(((m>>4)&1)===0){cfg.resolution="low_res";binToHz=1.62762;}else{cfg.resolution="high_res";binToHz=0.8138;}
      cfg.unit=((m>>5)&1)===0?"velocity":"acceleration";
      cfg.start_frequency=readU16(b,c);
      cfg.spectral_line_frequency=readU8(b,c); if(cfg.spectral_line_frequency===0) throw new Error("Invalid spectral_line_frequency");
      cfg.scale=dataScale(readU8(b,c));
      return {cfg:cfg,binToHz:binToHz};
    }

    function mirrorAllStats(selId, x,y,z, tC){
      // Always return min/max/avg keys; for normal frames we mirror the single stat
      var vx={min:x, max:x, avg:x}, vy={min:y, max:y, avg:y}, vz={min:z, max:z, avg:z};
      var tt={min:tC, max:tC, avg:tC};
      // If the device sent max_only or avg_only, values are still mirrored across all three
      // so the keys exist. meta will flag this behavior.
      return {vx: vx, vy: vy, vz: vz, tt: tt};
    }

    try{
      var out={}, fPort=port, len=bytes.length, rawHex=toHexStr(bytes.slice(0));
      if(!bytes || len===0){ return JSON.stringify(out); }

      var c={i:0};
      var header = readU8(bytes,c); // v3 header byte (hi nibble = proto)
      var proto = (header>>4);

      // ---- SENSOR EVENT v3 (normal/extended) on fPort 17/3 by length ----
      if ((fPort===17 || fPort===3) && (len===11 || len===45)) {
        if (len===11) {
          // NORMAL: one statistic only -> we mirror to expose all three keys
          var selection_raw = readU8(bytes,c);
          var selection_id = selection_raw & 0x03; // mask lowest 2 bits
          var selection = selName(selection_id);

          var conditions = readU8(bytes,c);
          var x = readU16(bytes,c)/100, y = readU16(bytes,c)/100, z = readU16(bytes,c)/100;
          var tC = readI16(bytes,c)/100, tF = cToF(tC);

          var filled = mirrorAllStats(selection_id, x,y,z, tC);

          var se = {
            protocol_version: 3,
            selection: selection,
            selection_id: selection_id,
            selection_raw: selection_raw,
            trigger_id: ((conditions>>6)&3),
            trigger: trigName((conditions>>6)&3),
            conditions_raw: conditions,
            condition_0: (conditions&1),
            condition_1: ((conditions>>1)&1),
            condition_2: ((conditions>>2)&1),
            condition_3: ((conditions>>3)&1),
            condition_4: ((conditions>>4)&1),
            rms_velocity: { x:{}, y:{}, z:{} },
            temperature: {}
          };

          // Fill all three stats for each axis and temperature
          se.rms_velocity.x.min=filled.vx.min; se.rms_velocity.x.max=filled.vx.max; se.rms_velocity.x.avg=filled.vx.avg;
          se.rms_velocity.y.min=filled.vy.min; se.rms_velocity.y.max=filled.vy.max; se.rms_velocity.y.avg=filled.vy.avg;
          se.rms_velocity.z.min=filled.vz.min; se.rms_velocity.z.max=filled.vz.max; se.rms_velocity.z.avg=filled.vz.avg;
          se.temperature.min=filled.tt.min; se.temperature.max=filled.tt.max; se.temperature.avg=filled.tt.avg;

          // Flat convenience keys
          out.Vib_Velocity = {
            X_Axis_Min: filled.vx.min, X_Axis_Max: filled.vx.max, X_Axis_RMS: filled.vx.avg,
            Y_Axis_Min: filled.vy.min, Y_Axis_Max: filled.vy.max, Y_Axis_RMS: filled.vy.avg,
            Z_Axis_Min: filled.vz.min, Z_Axis_Max: filled.vz.max, Z_Axis_RMS: filled.vz.avg
          };
          out.Temperature = {
            Min: filled.tt.min, Max: filled.tt.max, Avg: filled.tt.avg,
            MinF: tF, MaxF: tF, AvgF: tF
          };

          out.sensor_event = se;
          out.meta = {
            port: fPort, length: len,
            header_byte: "0x"+hex2(header,2),
            protocol_version: 3,
            payload_hex: rawHex,
            units: { velocity: "mm/s", temperature: "°C" },
            // let downstream know these were mirrored from a single-stat frame
            mirrored_from_selection: selection
          };

          return JSON.stringify(out);
        } else {
          // EXTENDED: true min/max/avg + accel + correct temperature
          var selection = readU8(bytes,c); // 0 => extended
          var conditions = readU8(bytes,c);

          function vel(){ return readU16(bytes,c)/100.0; }
          function acc(){ return readI16(bytes,c)/100.0; }
          function tmp(){ return readI16(bytes,c)/100.0; }

          var se = {
            protocol_version: 3,
            selection: selName(selection),
            selection_id: selection,
            selection_raw: selection,
            trigger_id: ((conditions>>6)&3),
            trigger: trigName((conditions>>6)&3),
            conditions_raw: conditions,
            condition_0: (conditions&1),
            condition_1: ((conditions>>1)&1),
            condition_2: ((conditions>>2)&1),
            condition_3: ((conditions>>3)&1),
            condition_4: ((conditions>>4)&1),
            rms_velocity: { x:{}, y:{}, z:{} },
            acceleration: { x:{}, y:{}, z:{} },
            temperature: {}
          };

          se.rms_velocity.x.min=vel(); se.rms_velocity.x.max=vel(); se.rms_velocity.x.avg=vel();
          se.rms_velocity.y.min=vel(); se.rms_velocity.y.max=vel(); se.rms_velocity.y.avg=vel();
          se.rms_velocity.z.min=vel(); se.rms_velocity.z.max=vel(); se.rms_velocity.z.avg=vel();

          se.acceleration.x.min=acc(); se.acceleration.x.peak=acc(); se.acceleration.x.rms=acc();
          se.acceleration.y.min=acc(); se.acceleration.y.peak=acc(); se.acceleration.y.rms=acc();
          se.acceleration.z.min=acc(); se.acceleration.z.peak=acc(); se.acceleration.z.rms=acc();

          var tMin=tmp(), tMax=tmp(), tAvg=tmp();

          se.temperature.min=tMin; se.temperature.max=tMax; se.temperature.avg=tAvg;

          out.Vib_Velocity = {
            X_Axis_Min: se.rms_velocity.x.min, X_Axis_Max: se.rms_velocity.x.max, X_Axis_RMS: se.rms_velocity.x.avg,
            Y_Axis_Min: se.rms_velocity.y.min, Y_Axis_Max: se.rms_velocity.y.max, Y_Axis_RMS: se.rms_velocity.y.avg,
            Z_Axis_Min: se.rms_velocity.z.min, Z_Axis_Max: se.rms_velocity.z.max, Z_Axis_RMS: se.rms_velocity.z.avg
          };
          out.Vib_Accel = {
            X_Axis_Min: se.acceleration.x.min, X_Axis_Peak: se.acceleration.x.peak, X_Axis_RMS: se.acceleration.x.rms,
            Y_Axis_Min: se.acceleration.y.min, Y_Axis_Peak: se.acceleration.y.peak, Y_Axis_RMS: se.acceleration.y.rms,
            Z_Axis_Min: se.acceleration.z.min, Z_Axis_Peak: se.acceleration.z.peak, Z_Axis_RMS: se.acceleration.z.rms
          };
          out.Temperature = {
            Min: tMin, Max: tMax, Avg: tAvg,
            MinF: cToF(tMin), MaxF: cToF(tMax), AvgF: cToF(tAvg)
          };

          out.sensor_event = se;
          out.meta = {
            port: fPort, length: len,
            header_byte: "0x"+hex2(header,2),
            protocol_version: 3,
            payload_hex: rawHex,
            units: { velocity: "mm/s", acceleration: "m/s^2", temperature: "°C" }
          };
          return JSON.stringify(out);
        }
      }

      // Sensor data (FFT) 46 bytes on 17/4 (unchanged)
      if( (fPort===17 || fPort===4) && len===46 ){
        var cfg = parseConfigV3(bytes,c);
        var chunk=39, dataOff=7;
        var raw = bytes.slice(dataOff);
        var deltaF = cfg.cfg.spectral_line_frequency * cfg.binToHz;
        var f0 = cfg.cfg.start_frequency * deltaF + cfg.cfg.frame_number * chunk * deltaF;

        var freq=[], mag=[];
        for(var i=0;i<chunk;i++){ freq[i]=f0 + i*deltaF; mag[i]= raw[i] * cfg.cfg.scale / 255.0; }
        out.sensor_data = { protocol_version:3, config:cfg.cfg, frequency:freq, magnitude:mag };
        out.meta = { port:fPort, length:len, header_byte:"0x"+hex2(header,2), protocol_version:3, payload_hex: rawHex, units:{ magnitude:"unit per scale", frequency:"Hz" } };
        return JSON.stringify(out);
      }

      // Device status (9/12) on 17/2 (unchanged)
      if( (fPort===17 || fPort===2) && (len===9 || len===12) ){
        var ds = { protocol_version:3, base:{}, sensor:{} };
        ds.base.battery_voltage = battV(bytes,c);
        ds.base.temperature = readI8(bytes,c);
        ds.base.lora_tx_counter = readU16(bytes,c);
        ds.base.avg_rssi = rssiBucket(readU8(bytes,c));
        ds.base.bist = "0x"+hex2(readU8(bytes,c),2);
        ds.sensor.event_counter = readU8(bytes,c);
        ds.sensor.bist = "0x"+hex2(readU8(bytes,c),2);
        if(len===12){ ds.debug = "0x"; for(var j=c.i;j<bytes.length;j++) ds.debug += hex2(bytes[j],2); }
        out.device_status = ds;
        out.meta = { port:fPort, length:len, header_byte:"0x"+hex2(header,2), protocol_version:3, payload_hex: rawHex };
        return JSON.stringify(out);
      }

      // Boot short (3/35) on 17/1 (unchanged)
      if( (fPort===17 || fPort===1) && (len===3 || len===35) ){
        var boot = { protocol_version:3, base:{}, sensor:{} };
        var base_reason = readU8(bytes,c), sensor_reason = readU8(bytes,c);
        function major(x){var m=x&0x0F;return m===0?"none":m===1?"config update":m===2?"firmware update":m===3?"button reset":m===4?"power":m===5?"communication failure":"system failure";}
        function minor(x){var M=x&0x0F,m=(x>>4)&0x0F; if(M===2){return m===0?"success":m===1?"rejected":m===2?"error":m===3?"in progress":"unknown";} if(M===4){return m===0?"black out":m===1?"brown out":m===2?"power safe state":"unknown";} return ""; }
        boot.base = { reboot_reason:{major:major(base_reason), minor:minor(base_reason)} };
        boot.sensor = { reboot_reason:{major:major(sensor_reason), minor:minor(sensor_reason)} };
        if(len===35){ boot.debug="0x"; for(var j=c.i;j<bytes.length;j++) boot.debug+=hex2(bytes[j],2); }
        out.boot = boot;
        out.meta = { port:fPort, length:len, header_byte:"0x"+hex2(header,2), protocol_version:3, payload_hex: rawHex };
        return JSON.stringify(out);
      }

      // Fallback to original Decode function for other cases
      return Decode(fPort, bytes);

    }catch(e){
      return JSON.stringify({ "Errors/decodeError": (e && e.message) ? e.message : String(e) });
    }
  }

  /**
   * Decoder for plain HEX string
   */
  function DecodeHexString(fPort, hex_string) {
    return Decode(fPort, from_hex_string(hex_string));
  }

  /******************
   * Helper functions
   */

  /**
    * Decode header
    */
  function decode_header(bytes, cursor) {
    var header = {};
    var data = decode_uint8(bytes, cursor);

    header.protocol_version = data >> 4;
    header.message_type = message_type_lookup(data & 0x0F);

    return header;
  }

  /**
    * Decode header V3
    */
  function decode_header_v3(bytes, cursor) {
    var header = {};
    var data = decode_uint8(bytes, cursor);

    header.protocol_version = data >> 4;

    return header;
  }

  /**
    * Get protocol version without increasing cursor
    */
  function get_protocol_version(bytes) {
    var cursor = {};
    cursor.value = 0;

    var data = decode_uint8(bytes, cursor);

    var protocol_version = data >> 4;

    return protocol_version;
  }

  /**
    * Decode config header
    */
  function decode_config_header(bytes, cursor) {
    var header = {};
    var data = decode_uint8(bytes, cursor);

    header.protocol_version = data >> 4;
    header.config_type = config_type_lookup(data & 0x0F);

    return header;
  }

  // helper function to convert a ASCII HEX string to a byte string
  function from_hex_string(hex_string) {
    if (typeof hex_string != "string") throw new Error("hex_string must be a string");
    if (!hex_string.match(/^[0-9A-F]*$/gi)) throw new Error("hex_string contain only 0-9, A-F characters");
    if (hex_string.length & 0x01 > 0) throw new Error("hex_string length must be a multiple of two");

    var byte_string = [];
    for (i = 0; i < hex_string.length; i += 2) {
      var hex = hex_string.slice(i, i + 2);
      byte_string.push(parseInt(hex, 16));
    }
    return byte_string;
  }

  // pad zeros on decimal number
  function pad(num, size) {
    num = num.toString();
    while (num.length < size) num = "0" + num;
    return num;
  }

  // helper function to parse an 32 bit float
  function decode_float(bytes, cursor) {
    // JavaScript bitwise operators yield a 32 bits integer, not a float.
    // Assume LSB (least significant byte first).
    var bits = decode_int32(bytes, cursor);
    var sign = (bits >>> 31 === 0) ? 1.0 : -1.0;
    var e = bits >>> 23 & 0xff;
    if (e == 0xFF) {
      if (bits & 0x7fffff) {
        return NaN;
      } else {
        return sign * Infinity;
      }
    }
    var m = (e === 0) ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
    var f = sign * m * Math.pow(2, e - 150);
    return f;
  }

  // helper function to parse an unsigned uint32
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

  // helper function to parse an unsigned int32
  function decode_int32(bytes, cursor) {
    var result = 0;
    var i = cursor.value + 3;
    result = (result << 8) | bytes[i--];
    result = (result << 8) | bytes[i--];
    result = (result << 8) | bytes[i--];
    result = (result << 8) | bytes[i--];
    cursor.value += 4;

    return result;
  }

  // helper function to parse an unsigned uint16
  function decode_uint16(bytes, cursor) {
    var result = 0;
    var i = cursor.value + 1;
    result = bytes[i--];
    result = result * 256 + bytes[i--];
    cursor.value += 2;

    return result;
  }

  // helper function to parse a signed int16
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

  // helper function to parse an unsigned int8
  function decode_uint8(bytes, cursor) {
    var result = bytes[cursor.value];
    cursor.value += 1;

    return result;
  }

  // helper function to parse an unsigned int8
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

  // helper function to parse device_id
  function decode_device_id(bytes, cursor) {
    // bytes[0]
    var prefix = decode_uint8(bytes, cursor).toString();

    // bytes[1..5]
    var serial = pad(decode_uint32(bytes, cursor), 10);

    var device_id = prefix + "-" + serial;

    return device_id;
  }

  // helper function to parse fft config in sensor_data
  function decode_sensor_data_config(bytes, cursor, protocol_version) {
    var PROTOCOL_VERSION_V1 = 1;
    var PROTOCOL_VERSION_V2 = 2;

    config = decode_uint32(bytes, cursor);
    var result = {};

    // bits[0..7]
    result.frame_number = config & 0xFF;

    // bits[8..9]
    result.sequence_number = (config >> 8) & 0x03;

    // bits[10..11]
    result.axis = "";
    switch ((config >> 10) & 0x3) {
      case 0:
        result.axis = "x";
        break;
      case 1:
        result.axis = "y";
        break;
      case 2:
        result.axis = "z";
        break;
      default:
        throw new Error("Invalid axis value in sensor data config!");
    }

    // bits[12]
    switch ((config >> 12) & 0x1) {
      case 0:
        result.unit = "velocity";
        break;
      case 1:
      default:
        result.unit = "acceleration";
        break;
    }

    switch (protocol_version) {
      case PROTOCOL_VERSION_V1:
        // bits[13..18]
        result.scale = ((config >> 13) & 0x3F) * 4;
        if (result.scale == 0) {
          throw new Error("Invalid config.scale value!");
        }
        break;

      case PROTOCOL_VERSION_V2:
        // bits[13..16]
        var scale_coefficient = ((config >> 13) & 0x0F);
        if (scale_coefficient < 1 || scale_coefficient > 15) {
          throw new Error("Invalid config.scale coefficient value!");
        }
        // bits[17..18]
        var scale_power = ((config >> 17) & 0x03) - 2;
        result.scale = scale_coefficient * Math.pow(10, scale_power);
        break;

      default:
        throw new Error("Unsupported protocol version!");
    }

    // bits[19..31]
    result.start_frequency = config >>> 19;
    if (result.start_frequency < 0 || result.start_frequency > 8191) {
      throw new Error("Invalid start_frequency value in sensor data config!");
    }

    // bytes[5]
    result.spectral_line_frequency = decode_uint8(bytes, cursor);
    if (result.spectral_line_frequency == 0) {
      throw new Error("Invalid spectral_line_frequency value in sensor data config!");
    }


    return result;
  }

  // helper function to parse fft config in sensor_data
  function decode_sensor_data_config_v3(bytes, cursor) {
    var result = {};

    result.frame_number = decode_uint8(bytes, cursor);

    var b = decode_uint8(bytes, cursor);

    // bits[0..1]
    result.sequence_number = b & 0x03;

    // bits[2..3]
    result.axis = "";
    switch ((b >> 2) & 0x3) {
      case 0:
        result.axis = "x";
        break;
      case 1:
        result.axis = "y";
        break;
      case 2:
        result.axis = "z";
        break;
      default:
        throw new Error("Invalid axis value in sensor data config!");
    }

    // bits[4]
    switch ((b >> 4) & 0x1) {
      case 0:
        result.resolution = "low_res";
  var binToHzFactor = 1.62762;
        break;
      case 1:
  result.resolution = "high_res";
  var binToHzFactor = 0.8138;
      default:
        break;
    }

    // bits[5]
    switch ((b >> 5) & 0x1) {
      case 0:
        result.unit = "velocity";
        break;
      case 1:
      default:
        result.unit = "acceleration";
        break;
    }

    // bytes[3..4]
    result.start_frequency = decode_uint16(bytes, cursor);
    if (result.start_frequency > 8191) {
      throw new Error("Invalid start_frequency value in sensor data config!");
    }

    // bytes[5]
    result.spectral_line_frequency = decode_uint8(bytes, cursor);
    if (result.spectral_line_frequency == 0) {
      throw new Error("Invalid spectral_line_frequency value in sensor data config!");
    }

    // bytes[6]
    result.scale = data_scale_lookup(decode_uint8(bytes, cursor));

    return {result: result, binToHzFactor: binToHzFactor};
  }

  function data_scale_lookup(scale_idx) {
    var scale_value = [0.0100000000000000, 0.0108175019990394, 0.0117018349499221, 0.0126584622963211, 0.0136932941195217, 0.0148127236511360, 0.0160236667707382, 0.0173336047324401, 0.0187506303843729, 0.0202834981666202, 0.0219416781964925, 0.0237354147752836, 0.0256757896779659, 0.0277747906168310, 0.0300453853020469, 0.0325016015566801, 0.0351586139811367, 0.0380328377024400, 0.0411420297875284, 0.0445053989471126, 0.0481437242078435, 0.0520794832859547, 0.0563369914554751, 0.0609425517689466, 0.0659246175587139, 0.0713139682227294, 0.0771438993808804, 0.0834504285766365, 0.0902725177948457, 0.0976523141704060, 0.105635410374919, 0.114271126290003, 0.123612813707458, 0.133718185938731, 0.144649674370014, 0.156474814165802, 0.169266661503788, 0.183104244918794, 0.198073053544165, 0.214265565266983, 0.231781818060089, 0.250730028020599, 0.271227257933203, 0.293400140488639, 0.317385660625428, 0.343332001828200, 0.371399461611073, 0.401761441841993, 0.434605520026269, 0.470134608167771, 0.508568206367245, 0.550143758902554, 0.595118121168740, 0.643769146540740, 0.696397402962432, 0.753328029867193, 0.814912746902074, 0.881532026865585, 0.953597446283568, 1.03155422814513, 1.11588399250775, 1.20710773196486, 1.30578903035857, 1.41253754462275, 1.52801277126748, 1.65292812077436, 1.78805532507451, 1.93422920533864, 2.09235282953511, 2.26340309161917, 2.44843674682223, 2.64859694032709, 2.86512026966378, 3.09934442445761, 3.35271645072817, 3.62680169079642, 3.92329345403096, 4.24402347817979, 4.59097324591799, 4.96628622652541, 5.37228111832403, 5.81146617368716, 6.28655469512105, 6.80048179815422, 7.35642254459641, 7.95781155819499, 8.60836424387529, 9.31209974165798, 10.0733657570639, 10.8968654214094, 11.7876863479359, 12.7513320632845, 13.7937560084995, 14.9213983196205, 16.1412256150957, 17.4607740358243, 18.8881958037304, 20.4323095865101, 22.1026549797064, 23.9095514427051, 25.8641620527597, 27.9785624709206, 30.2658155459431, 32.7400520170796, 35.4165578143412, 38.3118684955729, 41.4438714037792, 44.8319161758313, 48.4969342852820, 52.4615683578319, 56.7503120583586, 61.3896614137401, 66.4082785063484, 71.8371685495186, 77.7098714389746, 84.0626689636199, 90.9348089558542, 98.3687477662216, 106.410412560410, 115.109485059084, 124.519708473503, 134.699219533192, 145.710907656935, 157.622803486073, 170.508499180478, 184.447603073803, 199.526231496888];

    if (scale_idx >= 127) {
      throw new Error("Invalid scale index in sensor data config!");
    }

    return scale_value[scale_idx];
  }

  // helper function to parse reboot_info
  function decode_reboot_info(reboot_type, bytes, cursor) {
    var result;

    var reboot_payload = [0, 0, 0, 0, 0, 0, 0, 0];
    reboot_payload[0] += decode_uint8(bytes, cursor);
    reboot_payload[1] += decode_uint8(bytes, cursor);
    reboot_payload[2] += decode_uint8(bytes, cursor);
    reboot_payload[3] += decode_uint8(bytes, cursor);
    reboot_payload[4] += decode_uint8(bytes, cursor);
    reboot_payload[5] += decode_uint8(bytes, cursor);
    reboot_payload[6] += decode_uint8(bytes, cursor);
    reboot_payload[7] += decode_uint8(bytes, cursor);

    switch (reboot_type) {
      case 0: // REBOOT_INFO_TYPE_NONE
        result = 'none';
        break;

      case 1: // REBOOT_INFO_TYPE_POWER_CYCLE
        result = 'power cycle';
        break;

      case 2: // REBOOT_INFO_TYPE_WDOG
        result = 'swdog (' + String.fromCharCode(
          reboot_payload[0],
          reboot_payload[1],
          reboot_payload[2],
          reboot_payload[3]).replace(/[^\x20-\x7E]/g, '') + ')';

        break;

      case 3: // REBOOT_INFO_TYPE_ASSERT
        var payloadCursor = {}; // keeping track of which byte to process.
        payloadCursor.value = 4; // skip caller address
        actualValue = decode_int32(reboot_payload, payloadCursor);
        result = 'assert (' +
          'caller: 0x' +
          uint8_to_hex(reboot_payload[3]) +
          uint8_to_hex(reboot_payload[2]) +
          uint8_to_hex(reboot_payload[1]) +
          uint8_to_hex(reboot_payload[0]) +
          '; value: ' + actualValue.toString() + ')';
        break;

      case 4: // REBOOT_INFO_TYPE_APPLICATION_REASON
        result = 'application (0x' +
          uint8_to_hex(reboot_payload[3]) +
          uint8_to_hex(reboot_payload[2]) +
          uint8_to_hex(reboot_payload[1]) +
          uint8_to_hex(reboot_payload[0]) + ')';
        break;

      case 5: // REBOOT_INFO_TYPE_SYSTEM_ERROR
        result = 'system (error: 0x' +
          uint8_to_hex(reboot_payload[3]) +
          uint8_to_hex(reboot_payload[2]) +
          uint8_to_hex(reboot_payload[1]) +
          uint8_to_hex(reboot_payload[0]) +
          '; caller: 0x' +
          uint8_to_hex(reboot_payload[7]) +
          uint8_to_hex(reboot_payload[6]) +
          uint8_to_hex(reboot_payload[5]) +
          uint8_to_hex(reboot_payload[4]) + ')';
        break;

      default:
        result = 'unknown (' +
          '0x' + uint8_to_hex(reboot_payload[0]) + ', ' +
          '0x' + uint8_to_hex(reboot_payload[1]) + ', ' +
          '0x' + uint8_to_hex(reboot_payload[2]) + ', ' +
          '0x' + uint8_to_hex(reboot_payload[3]) + ', ' +
          '0x' + uint8_to_hex(reboot_payload[4]) + ', ' +
          '0x' + uint8_to_hex(reboot_payload[5]) + ', ' +
          '0x' + uint8_to_hex(reboot_payload[6]) + ', ' +
          '0x' + uint8_to_hex(reboot_payload[7]) + ')';
        break;
    }

    return result;
  }

  /**
    * Decode battery voltage based on protocol version 3
    *
    * Raw value is between 0 - 255
    * 0 represent 2 V, while 255 represent 4 V
    */
  function decode_battery_voltage(bytes, cursor) {
    var raw = decode_uint8(bytes, cursor);

    var offset = 2; // Lowest voltage is 2 V
    var scale = 2 / 255;

    var voltage = raw * scale + offset;

    return voltage;
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
    type_names = ["boot",
      "activated",
      "deactivated",
      "sensor_event",
      "device_status",
      "base_configuration",
      "sensor_configuration",
      "sensor_data_configuration",
      "sensor_data"];
    if (type_id < type_names.length) {
      return type_names[type_id];
    } else {
      return "unknown";
    }
  }

  function config_type_lookup(type_id) {
    type_names = [
      "base",
      "region",
      "reserved",
      "sensor",
      "sensor_data",
      "sensor_conditions"];
    if (type_id < type_names.length) {
      return type_names[type_id];
    } else {
      return "unknown";
    }
  }

  function device_types_lookup(type_id) {
    type_names = ["", // reserved
      "ts",
      "vs-qt",
      "vs-mt",
      "tt",
      "ld",
      "vb"];
    if (type_id < type_names.length) {
      return type_names[type_id];
    } else {
      return "unknown";
    }
  }

  function trigger_lookup(trigger_id) {
    switch (trigger_id) {
      case 0:
        return "timer";
      case 1:
        return "button";
      case 2:
        return "condition_0";
      case 3:
        return "condition_1";
      case 4:
        return "condition_2";
      case 5:
        return "condition_3";
      case 6:
        return "condition_4";
      case 7:
        return "condition_5";
      default:
        return "unknown";
    }
  }

  function rssi_lookup(rssi) {
    switch (rssi) {
      case 0:
        return "0..-79";
      case 1:
        return "-80..-99";
      case 2:
        return "-100..-129";
      case 3:
        return "<-129";
      default:
        return "unknown";
    }
  }

  function reboot_lookup_major(reboot_reason) {
    major_reboot_reason = reboot_reason & 0x0F;
    switch (major_reboot_reason) {
      case 0:
        return "none";
      case 1:
        return "config update";
      case 2:
        return "firmware update";
      case 3:
        return "button reset"
      case 4:
        return "power";
      case 5:
        return "communication failure";
      default:
        return "system failure";
    }
  }

  function reboot_lookup_minor(reboot_reason) {
    major_reboot_reason = reboot_reason & 0x0F;
    minor_reboot_reason = (reboot_reason >> 4) & 0x0F;

    switch (major_reboot_reason) {
      case 0:
        return ""; // No minor reboot reason
      case 1:
        return ""; // No minor reboot reason
      case 2:
        switch (minor_reboot_reason) {
          case 0:
            return "success";
          case 1:
            return "rejected";
          case 2:
            return "error";
          case 3:
            return "in progress";
          default:
            return "unknown";
        }
      case 3:
        return ""; // No minor reboot reason
      case 4:
        switch (minor_reboot_reason) {
          case 0:
            return "black out";
          case 1:
            return "brown out";
          case 2:
            return "power safe state";
          default:
            return "unknown";
        }
      case 5:
        return ""; // No minor reboot reason
      case 6:
        return ""; // No minor reboot reason
      default:
        return "unknown";
    }
  }

  function lookup_selection(selection) {
    switch (selection) {
      case 0:
        return "extended";
      case 1:
        return "min_only";
      case 2:
        return "max_only";
      case 3:
        return "avg_only";
      default:
        return "unknown";
    }
  }

  function deactivation_reason_lookup(deactivation_id) {
    switch (deactivation_id) {
      case 0:
        return "user_triggered";
      case 1:
        return "activation_user_timeout";
      case 2:
        return "activation_sensor_comm_fail";
      case 3:
        return "activation_sensor_meas_fail";  // VB does not have it
      default:
        return "unknown";
    }
  }

  Object.prototype.in = function () {
    for (var i = 0; i < arguments.length; i++)
      if (arguments[i] == this) return true;
    return false;
  }

  /***************************
   * Message decoder functions
   */

  function decode_boot_msg(bytes, cursor) {
    var boot = {};

    var expected_length = 46;
    if (bytes.length != expected_length) {
      throw new Error("Invalid boot message length " + bytes.length + " instead of " + expected_length);
    }

    boot.base = {};
    // byte[1]
    var device_type = decode_uint8(bytes, cursor);
    boot.base.device_type = device_types_lookup(device_type);

    // byte[2..5]
    var version_hash = decode_uint32(bytes, cursor);
    boot.base.version_hash = '0x' + uint32_to_hex(version_hash);

    // byte[6..7]
    var config_crc = decode_uint16(bytes, cursor);
    boot.base.config_crc = '0x' + uint16_to_hex(config_crc);

    // byte[8]
    var reset_flags = decode_uint8(bytes, cursor);
    boot.base.reset_flags = '0x' + uint8_to_hex(reset_flags);

    // byte[9]
    boot.base.reboot_counter = decode_uint8(bytes, cursor);

    // byte[10]
    base_reboot_type = decode_uint8(bytes, cursor);

    // byte[11..18]
    boot.base.reboot_info = decode_reboot_info(base_reboot_type, bytes, cursor);

    // byte[19]
    var bist = decode_uint8(bytes, cursor);
    boot.base.bist = '0x' + uint8_to_hex(bist);

    boot.sensor = {};
    // byte[20]
    var device_type = decode_uint8(bytes, cursor);
    boot.sensor.device_type = device_types_lookup(device_type);

    // byte[21..25]
    boot.sensor.device_id = decode_device_id(bytes, cursor);

    // byte[26..29]
    var version_hash = decode_uint32(bytes, cursor);
    boot.sensor.version_hash = '0x' + uint32_to_hex(version_hash);

    // byte[30..31]
    var config_crc = decode_uint16(bytes, cursor);
    boot.sensor.config_crc = '0x' + uint16_to_hex(config_crc);

    // byte[32..33]
    var data_config_crc = decode_uint16(bytes, cursor);
    boot.sensor.data_config_crc = '0x' + uint16_to_hex(data_config_crc);

    // byte[34]
    var reset_flags = decode_uint8(bytes, cursor);
    boot.sensor.reset_flags = '0x' + uint8_to_hex(reset_flags);

    // byte[35]
    boot.sensor.reboot_counter = decode_uint8(bytes, cursor);

    // byte[36]
    sensor_reboot_type = decode_uint8(bytes, cursor);

    // byte[37..44]
    boot.sensor.reboot_info = decode_reboot_info(sensor_reboot_type, bytes, cursor);

    // byte[45]
    var bist = decode_uint8(bytes, cursor);
    boot.sensor.bist = '0x' + uint8_to_hex(bist);

    return boot;
  }

  function decode_boot_msg_v3(bytes, cursor) {
    var expected_length_normal = 3;
    var expected_length_debug = 35;
    if (bytes.length != expected_length_normal && bytes.length != expected_length_debug) {
      throw new Error("Invalid boot message length " + bytes.length + " instead of " + expected_length_normal + " or " + expected_length_debug);
    }

    var boot = {};

    boot.base = {};
    boot.sensor = {};
    // byte[1]
    base_reboot_reason = decode_uint8(bytes, cursor);
    boot.base.reboot_reason = {};
    boot.base.reboot_reason.major = reboot_lookup_major(base_reboot_reason);
    boot.base.reboot_reason.minor = reboot_lookup_minor(base_reboot_reason);

    // byte[2]
    sensor_reboot_reason = decode_uint8(bytes, cursor);
    boot.sensor.reboot_reason = {};
    boot.sensor.reboot_reason.major = reboot_lookup_major(sensor_reboot_reason);
    boot.sensor.reboot_reason.minor = reboot_lookup_minor(sensor_reboot_reason);

    // debug data
    if (bytes.length == expected_length_debug) {
      boot.debug = '0x'
      for (var i = cursor.value; i < bytes.length; i++) {
        boot.debug = boot.debug + uint8_to_hex(bytes[i]);
      }
    }

    return boot;
  }

  function decode_activated_msg(bytes, cursor) {
    var activated = {};

    var expected_length = 7;
    if (bytes.length != expected_length) {
      throw new Error("Invalid activated message length " + bytes.length + " instead of " + expected_length);
    }

    activated.sensor = {};

    // byte[1]
    var device_type = decode_uint8(bytes, cursor);
    activated.sensor.device_type = device_types_lookup(device_type);

    // byte[2..6]
    activated.sensor.device_id = decode_device_id(bytes, cursor);

    return activated;
  }

  function decode_activated_msg_v3(bytes, cursor) {
    var activated = {};

    var expected_length = 8;
    if (bytes.length != expected_length) {
      throw new Error("Invalid activated message length " + bytes.length + " instead of " + expected_length);
    }

    activated.sensor = {};

    // byte[1]
    var device_type = decode_uint8(bytes, cursor);
    activated.sensor.device_type = device_types_lookup(device_type);

    // byte[2..6]
    activated.sensor.device_id = decode_device_id(bytes, cursor);

    activated.base = {};

    // byte[7]
    device_type = decode_uint8(bytes, cursor);
    activated.base.device_type = device_types_lookup(device_type);

    return activated;
  }

  function decode_deactivated_msg(bytes, cursor) {
    var deactivated = {};

    var expected_length = 3;
    if (bytes.length != expected_length) {
      throw new Error("Invalid deactivated message length " + bytes.length + " instead of " + expected_length);
    }

    // byte[1]
    var reason = decode_uint8(bytes, cursor);
    deactivated.reason = deactivation_reason_lookup(reason);

    // byte[2]
    var reason_length = decode_uint8(bytes, cursor);

    if (reason_length != 0) {
      throw new Error("Unsupported deactivated reason length");
    }

    return deactivated;
  }

  function decode_sensor_event_msg(bytes, cursor) {
    var sensor_event = {};

    var expected_length = 45;
    if (bytes.length != expected_length) {
      throw new Error("Invalid sensor_event message length " + bytes.length + " instead of " + expected_length);
    }

    // byte[1]
    trigger = decode_uint8(bytes, cursor);
    sensor_event.trigger = trigger_lookup(trigger);

    sensor_event.rms_velocity = {};

    // byte[2..7]
    sensor_event.rms_velocity.x = {};
    sensor_event.rms_velocity.x.min = decode_uint16(bytes, cursor) / 100;
    sensor_event.rms_velocity.x.max = decode_uint16(bytes, cursor) / 100;
    sensor_event.rms_velocity.x.avg = decode_uint16(bytes, cursor) / 100;

    // byte[8..13]
    sensor_event.rms_velocity.y = {};
    sensor_event.rms_velocity.y.min = decode_uint16(bytes, cursor) / 100;
    sensor_event.rms_velocity.y.max = decode_uint16(bytes, cursor) / 100;
    sensor_event.rms_velocity.y.avg = decode_uint16(bytes, cursor) / 100;

    // byte[14..19]
    sensor_event.rms_velocity.z = {};
    sensor_event.rms_velocity.z.min = decode_uint16(bytes, cursor) / 100;
    sensor_event.rms_velocity.z.max = decode_uint16(bytes, cursor) / 100;
    sensor_event.rms_velocity.z.avg = decode_uint16(bytes, cursor) / 100;

    sensor_event.acceleration = {};

    // byte[20..25]
    sensor_event.acceleration.x = {};
    sensor_event.acceleration.x.min = decode_int16(bytes, cursor) / 100;
    sensor_event.acceleration.x.max = decode_int16(bytes, cursor) / 100;
    sensor_event.acceleration.x.avg = decode_int16(bytes, cursor) / 100;

    // byte[26..31]
    sensor_event.acceleration.y = {};
    sensor_event.acceleration.y.min = decode_int16(bytes, cursor) / 100;
    sensor_event.acceleration.y.max = decode_int16(bytes, cursor) / 100;
    sensor_event.acceleration.y.avg = decode_int16(bytes, cursor) / 100;

    // byte[32..37]
    sensor_event.acceleration.z = {};
    sensor_event.acceleration.z.min = decode_int16(bytes, cursor) / 100;
    sensor_event.acceleration.z.max = decode_int16(bytes, cursor) / 100;
    sensor_event.acceleration.z.avg = decode_int16(bytes, cursor) / 100;

    // byte[38..43]
    sensor_event.temperature = {};
    sensor_event.temperature.min = decode_int16(bytes, cursor) / 100;
    sensor_event.temperature.max = decode_int16(bytes, cursor) / 100;
    sensor_event.temperature.avg = decode_int16(bytes, cursor) / 100;

    // byte[44]
    var conditions = decode_uint8(bytes, cursor);
    sensor_event.condition_0 = (conditions & 1);
    sensor_event.condition_1 = ((conditions >> 1) & 1);
    sensor_event.condition_2 = ((conditions >> 2) & 1);
    sensor_event.condition_3 = ((conditions >> 3) & 1);
    sensor_event.condition_4 = ((conditions >> 4) & 1);
    sensor_event.condition_5 = ((conditions >> 5) & 1);

    return sensor_event;
  }

  function decode_sensor_event_msg_v3(bytes, curser) {
    var expected_length_normal = 11;
    var expected_length_extended = 45;
    if (bytes.length == expected_length_normal) {
      return decode_sensor_event_msg_normal(bytes, curser);
    }
    else if (bytes.length == expected_length_extended) {
      return decode_sensor_event_msg_extended(bytes, curser);
    }
    else {
      throw new Error("Invalid sensor_event message length " + bytes.length + " instead of " + expected_length_normal + " or " + expected_length_extended);
    }
  }

  function decode_sensor_event_msg_normal(bytes, cursor) {
    var sensor_event = {};

    // byte[1]
    selection = decode_uint8(bytes, cursor);

    sensor_event.selection = lookup_selection(selection);
    if (sensor_event.selection == "extended") {
      throw new Error("Mismatch between extended bit flag and message length!");
    }

    // byte[2]
    var conditions = decode_uint8(bytes, cursor);
    sensor_event.condition_0 = (conditions & 1);
    sensor_event.condition_1 = ((conditions >> 1) & 1);
    sensor_event.condition_2 = ((conditions >> 2) & 1);
    sensor_event.condition_3 = ((conditions >> 3) & 1);
    sensor_event.condition_4 = ((conditions >> 4) & 1);

    sensor_event.trigger = lookup_trigger((conditions >> 6) & 3);

    sensor_event.rms_velocity = {};

    // byte[3,4]
    x = decode_uint16(bytes, cursor) / 100;

    // byte[5,6]
    y = decode_uint16(bytes, cursor) / 100;

    // byte[7,8]
    z = decode_uint16(bytes, cursor) / 100;

    // byte[9,10]
    temperature = decode_int16(bytes, cursor) / 100;

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
      throw new Error("Only min, max, or, avg is accepted!");
    }


    return sensor_event;
  }

  function decode_sensor_event_msg_extended(bytes, cursor) {
    var sensor_event = {};

    // byte[1]
    selection = decode_uint8(bytes, cursor);

    sensor_event.selection = lookup_selection(selection);
    if (sensor_event.selection != "extended") {
      throw new Error("Mismatch between extended bit flag and message length!");
    }

    // byte[2]
    var conditions = decode_uint8(bytes, cursor);
    sensor_event.condition_0 = (conditions & 1);
    sensor_event.condition_1 = ((conditions >> 1) & 1);
    sensor_event.condition_2 = ((conditions >> 2) & 1);
    sensor_event.condition_3 = ((conditions >> 3) & 1);
    sensor_event.condition_4 = ((conditions >> 4) & 1);

    sensor_event.trigger = lookup_trigger((conditions >> 6) & 3);

    sensor_event.rms_velocity = {};

    // byte[2..7]
    sensor_event.rms_velocity.x = {};
    sensor_event.rms_velocity.x.min = decode_velocity_v3(bytes, cursor);
    sensor_event.rms_velocity.x.max = decode_velocity_v3(bytes, cursor);
    sensor_event.rms_velocity.x.avg = decode_velocity_v3(bytes, cursor);

    // byte[8..13]
    sensor_event.rms_velocity.y = {};
    sensor_event.rms_velocity.y.min = decode_velocity_v3(bytes, cursor);
    sensor_event.rms_velocity.y.max = decode_velocity_v3(bytes, cursor);
    sensor_event.rms_velocity.y.avg = decode_velocity_v3(bytes, cursor);

    // byte[14..19]
    sensor_event.rms_velocity.z = {};
    sensor_event.rms_velocity.z.min = decode_velocity_v3(bytes, cursor);
    sensor_event.rms_velocity.z.max = decode_velocity_v3(bytes, cursor);
    sensor_event.rms_velocity.z.avg = decode_velocity_v3(bytes, cursor);

    sensor_event.acceleration = {};

    // byte[20..25]
    sensor_event.acceleration.x = {};
    sensor_event.acceleration.x.min = decode_acceleration_v3(bytes, cursor);
    sensor_event.acceleration.x.peak = decode_acceleration_v3(bytes, cursor);
    sensor_event.acceleration.x.rms = decode_acceleration_v3(bytes, cursor);

    // byte[26..31]
    sensor_event.acceleration.y = {};
    sensor_event.acceleration.y.min = decode_acceleration_v3(bytes, cursor);
    sensor_event.acceleration.y.peak = decode_acceleration_v3(bytes, cursor);
    sensor_event.acceleration.y.rms = decode_acceleration_v3(bytes, cursor);

    // byte[32..37]
    sensor_event.acceleration.z = {};
    sensor_event.acceleration.z.min = decode_acceleration_v3(bytes, cursor);
    sensor_event.acceleration.z.peak = decode_acceleration_v3(bytes, cursor);
    sensor_event.acceleration.z.rms = decode_acceleration_v3(bytes, cursor);

    // byte[38..43]
    sensor_event.temperature = {};
    sensor_event.temperature.min = decode_acceleration_v3(bytes, cursor);
    sensor_event.temperature.max = decode_acceleration_v3(bytes, cursor);
    sensor_event.temperature.avg = decode_acceleration_v3(bytes, cursor);

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
    var device_status = {};

    var expected_length = 24;
    if (bytes.length != expected_length) {
      throw new Error("Invalid device_status message length " + bytes.length + " instead of " + expected_length);
    }

    device_status.base = {};
    device_status.sensor = {};

    // byte[1..2]
    var config_crc = decode_uint16(bytes, cursor);
    device_status.base.config_crc = '0x' + uint16_to_hex(config_crc);

    // byte[3..8]
    device_status.base.battery_voltage = {}
    device_status.base.battery_voltage.low = decode_uint16(bytes, cursor) / 1000.0;
    device_status.base.battery_voltage.high = decode_uint16(bytes, cursor) / 1000.0;
    device_status.base.battery_voltage.settle = decode_uint16(bytes, cursor) / 1000.0;

    // byte[9..11]
    device_status.base.temperature = {}
    device_status.base.temperature.min = decode_int8(bytes, cursor);
    device_status.base.temperature.max = decode_int8(bytes, cursor);
    device_status.base.temperature.avg = decode_int8(bytes, cursor);

    // byte[12]
    device_status.base.lvds_error_counter = decode_uint8(bytes, cursor);

    // byte[13..15]
    device_status.base.lora_tx_counter = decode_uint8(bytes, cursor);
    device_status.base.avg_rssi = -decode_uint8(bytes, cursor);
    device_status.base.avg_snr = decode_int8(bytes, cursor);

    // byte[16]
    var bist = decode_uint8(bytes, cursor);
    device_status.base.bist = '0x' + uint8_to_hex(bist);

    // byte[17]
    var device_type = decode_uint8(bytes, cursor);
    device_status.sensor.device_type = device_types_lookup(device_type);

    // byte[18..19]
    var config_crc = decode_uint16(bytes, cursor);
    device_status.sensor.config_crc = '0x' + uint16_to_hex(config_crc);

    // byte[20..21]
    var data_config_crc = decode_uint16(bytes, cursor);
    device_status.sensor.data_config_crc = '0x' + uint16_to_hex(data_config_crc);

    // byte[22]
    device_status.sensor.event_counter = decode_uint8(bytes, cursor);

    // byte[23]
    var bist = decode_uint8(bytes, cursor);
    device_status.sensor.bist = '0x' + uint8_to_hex(bist);

    return device_status;
  }

  function decode_device_status_msg_v3(bytes, cursor) {
    var expected_length_normal = 9;
    var expected_length_debug = 12;
    if (bytes.length != expected_length_normal && bytes.length != expected_length_debug) {
      throw new Error("Invalid device status message length " + bytes.length + " instead of " + expected_length_normal + " or " + expected_length_debug);
    }

    var device_status = {};

    device_status.base = {};
    device_status.sensor = {};

    // byte[1]
    device_status.base.battery_voltage = decode_battery_voltage(bytes, cursor);

    // byte[2]
    device_status.base.temperature = decode_int8(bytes, cursor);

    // byte[3,4]
    device_status.base.lora_tx_counter = decode_uint16(bytes, cursor);

    // byte[5]
    rssi = decode_uint8(bytes, cursor);
    device_status.base.avg_rssi = rssi_lookup(rssi);

    // byte[6]
    var bist = decode_uint8(bytes, cursor);
    device_status.base.bist = '0x' + uint8_to_hex(bist);

    // byte[7]
    device_status.sensor.event_counter = decode_uint8(bytes, cursor);

    // byte[8]
    var bist = decode_uint8(bytes, cursor);
    device_status.sensor.bist = '0x' + uint8_to_hex(bist);

    // debug data
    if (bytes.length == expected_length_debug) {
      device_status.debug = '0x'
      for (var i = cursor.value; i < bytes.length; i++) {
        device_status.debug = device_status.debug + uint8_to_hex(bytes[i]);
      }
    }

    return device_status;
  }

  function decode_config_update_ans_msg(bytes, cursor) {
    var expected_length = 6;
    if (bytes.length != expected_length) {
      throw new Error("Invalid config update ans message length " + bytes.length + " instead of " + expected_length);
    }

    var ans = {};

    // NOTE: It does not check protocol_version because sensor can have different protocol_version compared to the base device
    // byte[0]
    ans = decode_config_header(bytes, cursor);

    // byte[1..4]
    tag = decode_uint32(bytes, cursor);
    ans.tag = '0x' + uint32_to_hex(tag);

    // byte[5]
    counter = decode_uint8(bytes, cursor);
    ans.counter = counter & 0x0F;

    return ans;
  }


  function lookup_trigger(trigger) {
    switch (trigger) {
      case (0):
        return "condition change";
      case (1):
        return "periodic";
      case (2):
        return "button press";
      default:
        return "unknown";
    }
  }

  function decode_sensor_data_msg(bytes, cursor, protocol_version) {
    var sensor_data = {};

    var expected_length = 46;
    if (bytes.length != expected_length) {
      throw new Error("Invalid sensor_data message length " + bytes.length + " instead of " + expected_length);
    }

    var fix_freq_offset = 0;
    if (protocol_version == 3) {
      // byte[1..6]
      var obj = decode_sensor_data_config_v3(bytes, cursor);
      sensor_data.config = obj.result;
      binToHzFactor = obj.binToHzFactor;
      chunk_size = 39;
      data_offset = 7;
    } else { // protocol == 2
      // byte[1..5]
      sensor_data.config = decode_sensor_data_config(bytes, cursor, protocol_version);
      var binToHzFactor = 1.62762;
      chunk_size = 40;
      data_offset = 6;
      // Fix for VBv2 where acceleration requires an offset
      if (sensor_data.config.unit == "acceleration"){
        fix_freq_offset = Math.min(2, sensor_data.config.start_frequency);
      }
    }

    // byte[data_offset..45] data_offset depending on protocol version
    sensor_data.raw = bytes.slice(data_offset);

    // Process raw data
    sensor_data.frequency = [];
    sensor_data.magnitude = [];

    // convert from bin to Hz
    var deltaF = sensor_data.config.spectral_line_frequency * binToHzFactor;
    // Start frequency (user sets starting line)
    var frequency_offset = (sensor_data.config.start_frequency - fix_freq_offset) * deltaF;
    // Frequency offset for the chunk
    frequency_offset += sensor_data.config.frame_number * chunk_size * deltaF;
    for (i = 0; i < chunk_size; i++) {
      sensor_data.frequency[i] = frequency_offset + i * deltaF;
      sensor_data.magnitude[i] = sensor_data.raw[i] * sensor_data.config.scale / 255;

    }

    return sensor_data;
  }

  function handle_generic_messages(fPort, bytes, decoded) {
    var FPORT_FIRMWARE_MANAGEMENT_PROTOCOL_SPECIFICATION = 203; // Firmware Management Protocol Specification TS006-1.0.0
    var cursor = {};   // keeping track of which byte to process.
    cursor.value = 0;  // Start from 0

    switch (fPort) {
      case FPORT_FIRMWARE_MANAGEMENT_PROTOCOL_SPECIFICATION: {
        var CID_DEV_VERSION = 0x01;
        var cid = decode_uint8(bytes, cursor);
        switch (cid) {
          case CID_DEV_VERSION:
            decoded.DevVersion = { FW_version: "0x" + uint32_to_hex(decode_uint32(bytes, cursor)), HW_version: "0x" + uint32_to_hex(decode_uint32(bytes, cursor)) }
            break;
        }
        return true;
      }
      default:
        return false;
    }
  }
