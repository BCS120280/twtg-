# TWTG Vibration Sensor Decoder for Sitesync

## Overview

This decoder (`decoder_vb_sitesync.js`) is an enhanced version of the TWTG Vibration sensor decoder specifically designed for Sitesync compatibility. It includes automatic error correction and robust handling of protocol variants.

## Key Features

1. **Auto-Detection**: Automatically detects the correct message type based on payload length
2. **Protocol Auto-Correction**: Corrects protocol version mismatches (e.g., when header says v1 but payload structure is v3)
3. **Robust Error Handling**: Handles firmware variants with extra bits in selection bytes
4. **Detailed Diagnostics**: Provides warnings and metadata about payload issues

## Usage in Sitesync

### Basic Setup

```javascript
// In Sitesync, use the decoder as follows:
function Decoder(bytes, port) {
  const decoder = require('./decoder_vb_sitesync.js');
  return decoder.decodeUplink({ fPort: port, bytes: bytes });
}
```

### Example Payload Decoding

**Payload**: `10394107090a07164a4740` (hex)

**Decoded Output**:
```json
{
  "data": {
    "sensor_event": {
      "selection": "min_only",
      "selection_raw": 57,
      "selection_note": "Extra bits detected in selection byte (0x39), using bits 0-1 only",
      "condition_0": 1,
      "condition_1": 0,
      "condition_2": 0,
      "condition_3": 0,
      "condition_4": 0,
      "trigger": "periodic",
      "rms_velocity": {
        "x": { "min": 23.11 },
        "y": { "min": 18.02 },
        "z": { "min": 189.66 }
      },
      "temperature": {
        "min": 164.55
      }
    },
    "metaData": {
      "protocol_version": 3,
      "fPort": 3,
      "payload_length": 11
    }
  },
  "warnings": [
    "Payload length 11 suggests Protocol v3 Sensor Event (normal), but header indicates v1 fPort=1. Auto-correcting to Protocol v3, fPort=3."
  ],
  "errors": []
}
```

## Decoded Fields

### Sensor Event Message

| Field | Description | Units |
|-------|-------------|-------|
| `selection` | Data selection type: `extended`, `min_only`, `max_only`, `avg_only` | - |
| `condition_0` to `condition_4` | Condition flags (0 = inactive, 1 = active) | boolean |
| `trigger` | Trigger type: `condition change`, `periodic`, `button press` | - |
| `rms_velocity.x/y/z` | RMS velocity for each axis | mm/s |
| `temperature` | Temperature reading | °C |

### MetaData

| Field | Description |
|-------|-------------|
| `protocol_version` | Detected protocol version (auto-corrected if needed) |
| `fPort` | LoRaWAN fPort used (auto-corrected if needed) |
| `payload_length` | Length of the payload in bytes |

## Known Issues & Workarounds

### Issue 1: Protocol Version Mismatch

**Problem**: Payload header indicates Protocol v1 (first byte `0x10`) but structure is Protocol v3.

**Auto-Fix**: The decoder automatically detects this based on payload length and corrects it.

**Warning**: `"Payload length 11 suggests Protocol v3 Sensor Event..."`

### Issue 2: Extra Bits in Selection Byte

**Problem**: Some firmware versions set additional bits in the selection byte beyond bits 0-1.

**Auto-Fix**: The decoder uses only bits 0-1 for selection value, ignoring extra bits.

**Note in Output**: `"Extra bits detected in selection byte (0xXX), using bits 0-1 only"`

### Issue 3: High Temperature Values

**Problem**: Temperature readings may appear abnormally high (e.g., 164.55°C).

**Possible Causes**:
- Sensor calibration issue
- Firmware encoding error
- Different temperature scale/offset

**Recommendation**: Verify the temperature reading with physical measurements and contact TWTG support if consistently incorrect.

## Supported Message Types

### Protocol v3

| fPort | Message Type | Normal Length | Extended/Debug Length |
|-------|--------------|---------------|----------------------|
| 1 | Boot | 3 bytes | 35 bytes |
| 2 | Device Status | 9 bytes | 12 bytes |
| 3 | Sensor Event | 11 bytes | 45 bytes |
| 4 | Sensor Data | 46 bytes | - |
| 5 | Activation | 8 bytes | - |
| 6 | Deactivation | 3 bytes | - |
| 7 | Config Update Answer | 6 bytes | - |

## Error Handling

The decoder provides structured error information:

```json
{
  "data": {
    "Errors": {
      "decodeError": "Error message here"
    },
    "metaData": {
      "diagnostics": {
        "code": "4",
        "raw_payload": "10394107090a07164a4740"
      }
    }
  },
  "warnings": [],
  "errors": ["Error message here"]
}
```

## Troubleshooting

### Common Error Messages

1. **"Invalid boot message length X instead of 3 or 35"**
   - Payload length doesn't match expected boot message format
   - Check if correct fPort is being used
   - Verify payload hasn't been truncated

2. **"Invalid sensor_event message length X instead of 11 or 45"**
   - Payload length doesn't match sensor event format
   - Auto-detection should handle this - check warnings

3. **"Unsupported protocol version: X"**
   - Protocol version in header is not 1, 2, or 3
   - Payload may be corrupted

### Testing the Decoder

Use the included test script:

```bash
node test_decoder.js
```

This will test your payload against all fPorts and show which one decodes successfully.

## Version Information

- **Based on**: decoder_vb_rev-12.js
- **Modified for**: Sitesync compatibility
- **Date**: 2025-11-07
- **Protocol Support**: v1, v2, v3 (with auto-detection)

## Support

For issues with:
- **Decoder functionality**: Open an issue in the TWTG repository
- **Sensor hardware/firmware**: Contact TWTG support
- **Sitesync integration**: Refer to Sitesync documentation

## License

Same license as the original TWTG decoder.
