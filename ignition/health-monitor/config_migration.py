# Configuration Migration Script for Health Monitor v2.0
# Run this script ONCE as a one-time gateway script to migrate hardcoded
# configuration values to tag-based configuration
#
# INSTRUCTIONS:
# 1. Update the configuration values below with your actual values
# 2. Run this script as a one-time gateway script or manual script execution
# 3. Verify tags are created under [default]Health/Config/*
# 4. Update PI Web API token to use secure password tags
# 5. Delete hardcoded values from original script

import json

# -------- CONFIGURATION VALUES TO MIGRATE --------

# Base Configuration
PROVIDER = "[default]"
HEALTH_BASE = PROVIDER + "Health"
CONFIG_BASE = HEALTH_BASE + "/Config"

# Configuration values from original script
config_values = {
    # SiteSync/Devices Configuration
    "DevicesRoot": "[default]SiteSync/Devices",
    "TimestampSuffix": "/LoRaMetrics/MesgTimeStamp",
    "TPStaleMs": 300000,  # 5 minutes
    "TPScanMinMs": 30000,  # 30 seconds

    # MQTT Configuration
    "MQTTTxStatusTag": "[MQTT Transmission]Transmission Info/Connected",
    "BrokerHost": "localhost",
    "BrokerPort": 1883,

    # SiteSync Configuration
    "SiteSyncTenantID": 1,

    # PI Adapter Configuration
    "PIAdapterBase": "https://pgwgen002923.mgroupnet.com:5590",
    "PIAdapterAPIURL": "https://pgwgen002923.mgroupnet.com:5590/api/v1/configuration",

    # PI Web API Configuration
    "PIWebAPIBase": "https://pgwgen002923.mgroupnet.com/piwebapi",
    "PIWebAPIEndpoint": "/system",
    "PIWebAPIUser": "",  # Leave empty if using token
    "PIWebAPIPass": "",  # Leave empty if using token
    "PIWebAPIToken": "",  # IMPORTANT: Move to secure password tag after migration
    "PIWebAPIAuthScheme": "Basic",  # "Basic" or "Bearer"
    "PIWebAPITimeoutMs": 5000,
    "PIWebAPIInsecureOK": False,

    # Actility Configuration
    "ActilityMQTTTLSPort": 8883,
    "ActilityHTTPSPort": 443,
    "ActilityRequireBoth": False,

    # DMZ Listener Configuration
    "DMZListenHost": "172.20.0.9",
    "DMZListenTLSPort": 8883,
    "MQTTSysRootTag": "",  # e.g., "[MQTT Engine]Chariot/$SYS/broker"
    "PIAdapterClientID": "",

    # SiteSync UI Configuration
    "SiteSyncUIHost": "172.20.0.9",
    "SiteSyncUIPort": 8043,
    "SiteSyncUIExternalIP": "199.192.37.144",

    # Azure Event Hub Configuration
    "EventHubDevHost": "10.53.212.188",
    "EventHubProdHost": "10.58.100.53",
    "EventHubPort": 5671,

    # Optional Health Check URLs
    "GeoEventHealthURL": "",
    "AzureHealthURL": "",
}

# IP Address Lists (stored as JSON strings)
ip_lists = {
    "ActilityTPXIPs": [
        "18.210.115.231",
        "52.1.89.48",
        "54.81.224.96"
    ],
    "ActilityHTTPSIPs": [
        "10.102.12.10",
        "54.224.165.180",
        "10.102.22.10",
        "3.224.202.202"
    ],
    "ActilityCloudfrontIPs": [
        "52.85.132.122", "52.85.132.36", "52.85.132.22", "52.85.132.23",
        "108.156.91.15", "108.156.91.112", "108.156.91.53", "108.156.91.116",
        "18.238.55.96", "18.238.55.29", "18.238.55.49", "18.238.55.12",
        "13.32.241.42", "13.32.241.74", "13.32.241.53", "13.32.241.86",
    ],
    "GreenDCIPs": []  # Add LDAP server IPs if needed
}

# -------- MIGRATION FUNCTIONS --------

def _mem_tag(name, dtype, value):
    """Create memory tag configuration"""
    return {
        "name": name,
        "tagType": "AtomicTag",
        "valueSource": "memory",
        "dataType": dtype,
        "value": value,
        "enabled": True
    }

def _string_tag(name, value):
    """Create string memory tag"""
    return _mem_tag(name, "String", value)

def _int_tag(name, value):
    """Create integer memory tag"""
    return _mem_tag(name, "Int4", value)

def _bool_tag(name, value):
    """Create boolean memory tag"""
    return _mem_tag(name, "Boolean", value)

def migrate_configuration():
    """Migrate all configuration values to tags"""

    print "=" * 60
    print "Health Monitor Configuration Migration"
    print "=" * 60

    # Ensure Config folder exists
    try:
        config_folder = [{"name": "Config", "tagType": "Folder"}]
        system.tag.configure(HEALTH_BASE, config_folder, "m")
        print "✓ Config folder created"
    except Exception as ex:
        print "✗ Failed to create Config folder: %s" % ex
        return False

    # Create simple configuration tags
    config_tags = []

    # Map configuration values to appropriate tag types
    type_mapping = {
        "TPStaleMs": "int",
        "TPScanMinMs": "int",
        "BrokerPort": "int",
        "SiteSyncTenantID": "int",
        "PIWebAPITimeoutMs": "int",
        "PIWebAPIInsecureOK": "bool",
        "ActilityMQTTTLSPort": "int",
        "ActilityHTTPSPort": "int",
        "ActilityRequireBoth": "bool",
        "DMZListenTLSPort": "int",
        "SiteSyncUIPort": "int",
        "EventHubPort": "int",
    }

    for key, value in config_values.items():
        tag_type = type_mapping.get(key, "string")

        if tag_type == "int":
            config_tags.append(_int_tag(key, int(value)))
        elif tag_type == "bool":
            config_tags.append(_bool_tag(key, bool(value)))
        else:
            config_tags.append(_string_tag(key, str(value)))

    # Create IP list tags (stored as JSON)
    for key, value in ip_lists.items():
        json_value = json.dumps(value)
        config_tags.append(_string_tag(key, json_value))

    # Write all configuration tags
    try:
        system.tag.configure(CONFIG_BASE, config_tags, "m")
        print "✓ Created %d configuration tags" % len(config_tags)
    except Exception as ex:
        print "✗ Failed to create configuration tags: %s" % ex
        return False

    # Create secure password tag for PI Web API token
    print ""
    print "=" * 60
    print "IMPORTANT: Security Configuration Required"
    print "=" * 60
    print ""
    print "To complete the migration securely:"
    print ""
    print "1. In Tag Browser, navigate to: [default]Health/Config/"
    print ""
    print "2. Edit the 'PIWebAPIToken' tag:"
    print "   - Change Data Type to: Password"
    print "   - Set the token value securely"
    print ""
    print "3. Similarly, if using username/password instead of token:"
    print "   - Change 'PIWebAPIPass' to Password data type"
    print ""
    print "4. Verify all configuration values are correct for your environment"
    print ""
    print "5. Test the new v2 script before removing the old one"
    print ""

    return True

# -------- VERIFICATION FUNCTION --------

def verify_configuration():
    """Verify that configuration tags exist and are readable"""

    print ""
    print "=" * 60
    print "Configuration Verification"
    print "=" * 60
    print ""

    # Check if Config folder exists
    try:
        result = system.tag.browse(CONFIG_BASE, {})
        tags = result.getResults()

        if not tags:
            print "✗ No configuration tags found under %s" % CONFIG_BASE
            return False

        print "✓ Found %d configuration tags" % len(tags)
        print ""

        # Read sample configuration values
        sample_tags = [
            CONFIG_BASE + "/DevicesRoot",
            CONFIG_BASE + "/BrokerHost",
            CONFIG_BASE + "/PIWebAPIBase",
        ]

        print "Sample configuration values:"
        print "-" * 60

        qv = system.tag.readBlocking(sample_tags)
        for i, path in enumerate(sample_tags):
            tag_name = path.split("/")[-1]
            q = qv[i]
            if q and q.quality.isGood():
                print "  %-30s: %s" % (tag_name, q.value)
            else:
                print "  %-30s: BAD QUALITY" % tag_name

        print ""
        print "✓ Configuration verification complete"
        print ""
        print "Next steps:"
        print "  1. Review all configuration values in Tag Browser"
        print "  2. Update PIWebAPIToken to use Password data type"
        print "  3. Test the v2 health monitor script"

        return True

    except Exception as ex:
        print "✗ Verification failed: %s" % ex
        return False

# -------- ROLLBACK FUNCTION --------

def rollback_configuration():
    """Remove all configuration tags (use with caution)"""

    print ""
    print "=" * 60
    print "Configuration Rollback"
    print "=" * 60
    print ""

    confirm = system.gui.confirm(
        "Are you sure you want to delete all configuration tags?\n\n"
        "This will remove: %s\n\n"
        "This action cannot be undone!" % CONFIG_BASE,
        "Confirm Rollback"
    )

    if not confirm:
        print "Rollback cancelled by user"
        return False

    try:
        # Get all config tags
        result = system.tag.browse(CONFIG_BASE, {})
        tags = result.getResults()

        # Delete each tag
        for tag in tags:
            fp = str(tag.get("fullPath", ""))
            try:
                system.tag.deleteTags([fp])
                print "  Deleted: %s" % fp
            except Exception as ex:
                print "  Failed to delete %s: %s" % (fp, ex)

        print ""
        print "✓ Rollback complete"
        return True

    except Exception as ex:
        print "✗ Rollback failed: %s" % ex
        return False

# -------- MAIN EXECUTION --------

if __name__ == "__main__":

    print ""
    print "╔══════════════════════════════════════════════════════════════╗"
    print "║  Health Monitor v2.0 - Configuration Migration Tool         ║"
    print "╚══════════════════════════════════════════════════════════════╝"
    print ""

    # Perform migration
    success = migrate_configuration()

    if success:
        # Verify migration
        verify_configuration()
        print ""
        print "╔══════════════════════════════════════════════════════════════╗"
        print "║  Migration Complete!                                         ║"
        print "║                                                              ║"
        print "║  Review the security instructions above before deploying    ║"
        print "║  the v2 health monitor script.                              ║"
        print "╚══════════════════════════════════════════════════════════════╝"
    else:
        print ""
        print "╔══════════════════════════════════════════════════════════════╗"
        print "║  Migration Failed                                            ║"
        print "║                                                              ║"
        print "║  Review the error messages above and try again.             ║"
        print "╚══════════════════════════════════════════════════════════════╝"
