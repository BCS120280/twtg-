# Health Monitor v2.0 - Quick Reference Card

## 🎯 Essential Operations

### Check Overall Health Status

```python
import system.tag
qv = system.tag.readBlocking([
    "[default]Health/Overall_Healthy",
    "[default]Health/Fault_Summary"
])
print "Healthy:", qv[0].value
print "Faults:", qv[1].value
```

---

### Enable/Disable Monitoring

```python
import system.tag

# Disable
system.tag.writeBlocking(["[default]Health/ENABLE_UNIFIED_MONITOR"], [False])

# Enable
system.tag.writeBlocking(["[default]Health/ENABLE_UNIFIED_MONITOR"], [True])
```

---

### Manual Execution

```python
from unified_health_monitor_v2 import main
main()
```

---

### Check Execution Performance

```python
import system.tag
ms = system.tag.readBlocking(["[default]Health/ScriptExecutionMs"])[0].value
print "Last execution:", ms, "ms"
```

---

### View Component Status

```python
import system.tag

component = "PI_WebAPI"  # Change as needed
base = "[default]Health/" + component

qv = system.tag.readBlocking([
    base + "/IsHealthy",
    base + "/Status",
    base + "/Message",
    base + "/LatencyMs"
])

print component + ":"
print "  Healthy:", qv[0].value
print "  Status:", qv[1].value
print "  Message:", qv[2].value
print "  Latency:", qv[3].value, "ms"
```

---

### Update Configuration

```python
import system.tag

# Example: Change broker host
system.tag.writeBlocking(
    ["[default]Health/Config/BrokerHost"],
    ["new-broker-hostname"]
)

# Example: Change timeout
system.tag.writeBlocking(
    ["[default]Health/Config/PIWebAPITimeoutMs"],
    [10000]  # 10 seconds
)
```

---

### Update IP Lists

```python
import system.tag
import json

# Read current list
path = "[default]Health/Config/ActilityTPXIPs"
current = system.tag.readBlocking([path])[0].value
ips = json.loads(current)

# Modify list
ips.append("54.123.45.67")
# or: ips.remove("18.210.115.231")

# Write back
system.tag.writeBlocking([path], [json.dumps(ips)])
print "Updated IP list:", ips
```

---

### Force Pipeline Reattachment

```python
import system.tag
system.tag.writeBlocking(
    ["[default]Health/_PipelinesAttached"],
    [False]
)
print "Pipelines will reattach on next execution"
```

---

### Test Individual Component

```python
# Test PI Web API
from unified_health_monitor_v2 import _pi_webapi_health
ok, ms, msg = _pi_webapi_health()
print "OK:", ok, "| Latency:", ms, "ms | Message:", msg

# Test TCP connection
from unified_health_monitor_v2 import _tcp
ok, ms = _tcp("localhost", 1883)
print "OK:", ok, "| Latency:", ms, "ms"
```

---

### Export Configuration Backup

```python
import system.tag

# Export all config
config = system.tag.getConfiguration("[default]Health/Config", True)
json_export = system.util.jsonEncode(config, 2)

# Print or save
print json_export

# Optional: Write to file tag
system.tag.writeBlocking(
    ["[default]System/ConfigBackup"],
    [json_export]
)
```

---

### View All Component Statuses

```python
import system.tag

components = [
    "ThingPark_Inbound", "MQTT_Broker", "MQTT_Transmission",
    "SiteSync_API", "PI_Adapter", "PI_Adapter_API",
    "PI_WebAPI", "Actility_API", "PI_Adapter_Link",
    "SiteSync_UI", "SiteSync_UI_External"
]

print "%-25s %8s %10s" % ("Component", "Healthy", "Latency")
print "-" * 45

for comp in components:
    path_h = "[default]Health/" + comp + "/IsHealthy"
    path_l = "[default]Health/" + comp + "/LatencyMs"
    qv = system.tag.readBlocking([path_h, path_l])

    healthy = "OK" if qv[0].value else "BAD"
    latency = qv[1].value if qv[1].value >= 0 else "N/A"

    print "%-25s %8s %10s" % (comp, healthy, str(latency) + " ms" if isinstance(latency, int) else latency)
```

---

### Check for Slow Components

```python
import system.tag

components = [
    "ThingPark_Inbound", "MQTT_Broker", "SiteSync_API",
    "PI_Adapter", "PI_WebAPI", "Actility_API"
]

threshold = 5000  # 5 seconds

print "Components with latency > %d ms:" % threshold
for comp in components:
    path = "[default]Health/" + comp + "/LatencyMs"
    ms = system.tag.readBlocking([path])[0].value
    if ms > threshold:
        print "  %s: %d ms" % (comp, ms)
```

---

### Reset Component Status

```python
import system.tag

component = "GeoEvent"  # Change as needed
base = "[default]Health/" + component

# Reset to healthy
system.tag.writeBlocking([
    base + "/IsHealthy",
    base + "/Status",
    base + "/Message"
], [
    True,
    "RESET",
    "Manually reset"
])
```

---

## 📊 Dashboard URLs

| Environment | URL |
|-------------|-----|
| Development | `http://dev-gateway:8043/data/perspective/client/HealthMonitor` |
| Test | `http://test-gateway:8043/data/perspective/client/HealthMonitor` |
| Production | `http://prod-gateway:8043/data/perspective/client/HealthMonitor` |

---

## 🔧 Common Configuration Paths

```
Main Config:           [default]Health/Config/
Enable/Disable:        [default]Health/ENABLE_UNIFIED_MONITOR
Overall Health:        [default]Health/Overall_Healthy
Fault Summary:         [default]Health/Fault_Summary
Execution Time:        [default]Health/ScriptExecutionMs
Last Execution:        [default]Health/LastExecutionTime

Component Structure:   [default]Health/{Component}/
  ├── IsHealthy        (Boolean - triggers alarm)
  ├── Status           (String - OK/BAD)
  ├── Message          (String - details)
  ├── LatencyMs        (Int4 - response time)
  ├── LastCheck        (DateTime)
  └── LastOK           (DateTime)
```

---

## 🚨 Emergency Procedures

### Disable All Monitoring

```python
import system.tag
system.tag.writeBlocking(["[default]Health/ENABLE_UNIFIED_MONITOR"], [False])
print "✓ Health monitoring disabled"
```

### Disable Specific Gateway Script

```
Gateway → Config → Scripting → Gateway Event Scripts
→ Find "Health Monitor v2"
→ Uncheck "Enabled"
→ Save
```

### Clear All Alarms

```
Gateway → Alarming → Alarm Status
→ Select all alarms with source "[default]Health/*"
→ Acknowledge & Clear
```

---

## 📈 Performance Benchmarks

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Execution Time | < 10s | 10-20s | > 20s |
| Component Latency | < 2s | 2-5s | > 5s |
| Overall Healthy | True | - | False |
| Alarm Count | 0 | 1-2 | > 3 |

---

## 🔍 Troubleshooting Commands

### Check Script Errors

```
Gateway → Status → Diagnostics → Logs
Filter: "health.unified"
Level: ERROR
```

### Verify Configuration Loaded

```python
import system.tag
result = system.tag.browse("[default]Health/Config", {})
count = len(result.getResults())
print "Config tags found:", count
# Should be 28+
```

### Test Network Connectivity

```python
from unified_health_monitor_v2 import _tcp

# Test MQTT broker
ok, ms = _tcp("localhost", 1883)
print "MQTT Broker:", "OK" if ok else "FAILED", "(%d ms)" % ms

# Test PI Web API server (443)
ok, ms = _tcp("your-pi-server", 443)
print "PI Server:", "OK" if ok else "FAILED", "(%d ms)" % ms
```

### Validate Credentials

```python
import system.tag

# Check if token is password type
cfg = system.tag.getConfiguration("[default]Health/Config/PIWebAPIToken", True)[0]
print "Token type:", cfg.get('dataType')  # Should be "Password"

# Verify readable
qv = system.tag.readBlocking(["[default]Health/Config/PIWebAPIToken"])[0]
print "Token quality:", qv.quality
print "Has value:", qv.value is not None
```

---

## 🎨 Color Codes (Dashboard)

```
Green (#10b981)  - Healthy / OK
Red (#ef4444)    - Unhealthy / Failed
Gray (#6b7280)   - Unknown / Skipped
```

---

## 📞 Support Escalation

| Severity | Response | Contact |
|----------|----------|---------|
| P1 - Critical | < 1 hour | On-call engineer |
| P2 - High | < 4 hours | Operations team |
| P3 - Medium | < 1 day | Integration team |
| P4 - Low | < 3 days | Dev team |

---

## 📋 Pre-Flight Checklist

Before deploying to production:

- [ ] Configuration migrated and verified
- [ ] Credentials secured as Password tags
- [ ] Script tested in dev environment
- [ ] Alarms trigger correctly
- [ ] Dashboard accessible
- [ ] Documentation reviewed
- [ ] Backup created
- [ ] Rollback plan prepared
- [ ] Monitoring team notified
- [ ] Change ticket approved

---

## 🔄 Maintenance Schedule

| Task | Frequency | Next Due |
|------|-----------|----------|
| Review execution times | Weekly | ________ |
| Check persistent failures | Weekly | ________ |
| Update IP lists | Monthly | ________ |
| Rotate credentials | Quarterly | ________ |
| Performance audit | Quarterly | ________ |
| Full system test | Annually | ________ |

---

**Quick Reference v2.0.0**
**Last Updated**: 2024

*For detailed documentation, see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)*
