# Unified Connection Health Monitor v2.0 — Refactored
# Improvements:
#   - Externalized configuration (no hardcoded credentials)
#   - Parallel execution for better performance
#   - Enhanced error handling and logging
#   - Execution time tracking
#   - Thread-safe caching
#   - Retry logic with exponential backoff

import time
import socket
from java.util.concurrent import Executors, TimeUnit, Callable
from java.lang import Runnable

# -------- Logger --------
try:
    LOG = system.util.getLogger("health.unified.v2")
except Exception:
    LOG = None

def _log(level, msg):
    """Safe logging wrapper"""
    try:
        if LOG:
            getattr(LOG, level)(msg)
    except Exception:
        pass

# -------- Configuration Loader --------
class Config:
    """Centralized configuration management - loads from tags"""

    def __init__(self):
        self.PROVIDER = "[default]"
        self.HEALTH_BASE = self.PROVIDER + "Health"
        self.CONFIG_BASE = self.HEALTH_BASE + "/Config"
        self.COUNTER_TAG = "[default]PI Integration/SiteSync/ConnectivityCheck/count"
        self.PIPELINE_NAME = "ConnAlarm"

        # Load configuration from tags
        self._load_config()

    def _load_config(self):
        """Load all configuration from tags with fallback defaults"""
        try:
            config_map = {
                "RUN_GATE_TAG": (self.HEALTH_BASE + "/ENABLE_UNIFIED_MONITOR", True),
                "DEVICES_ROOT": (self.CONFIG_BASE + "/DevicesRoot", "[default]SiteSync/Devices"),
                "TIMESTAMP_TAG_SUFFIX": (self.CONFIG_BASE + "/TimestampSuffix", "/LoRaMetrics/MesgTimeStamp"),
                "TP_STALE_MS": (self.CONFIG_BASE + "/TPStaleMs", 300000),  # 5 minutes
                "TP_SCAN_MIN_MS": (self.CONFIG_BASE + "/TPScanMinMs", 30000),  # 30 seconds

                "MQTT_TX_STATUS_TAG": (self.CONFIG_BASE + "/MQTTTxStatusTag", "[MQTT Transmission]Transmission Info/Connected"),
                "BROKER_HOST": (self.CONFIG_BASE + "/BrokerHost", "localhost"),
                "BROKER_PORT": (self.CONFIG_BASE + "/BrokerPort", 1883),

                "SITESYNC_TENANT_ID": (self.CONFIG_BASE + "/SiteSyncTenantID", 1),

                # PI Adapter - Base URL from config
                "PI_ADAPTER_BASE": (self.CONFIG_BASE + "/PIAdapterBase", ""),
                "PI_ADAPTER_API_URL": (self.CONFIG_BASE + "/PIAdapterAPIURL", ""),

                # PI Web API - credentials from secure tags
                "PI_WEBAPI_BASE": (self.CONFIG_BASE + "/PIWebAPIBase", ""),
                "PI_WEBAPI_ENDPOINT": (self.CONFIG_BASE + "/PIWebAPIEndpoint", "/system"),
                "PI_WEBAPI_USER": (self.CONFIG_BASE + "/PIWebAPIUser", ""),
                "PI_WEBAPI_PASS": (self.CONFIG_BASE + "/PIWebAPIPass", ""),  # Should use password tags
                "PI_WEBAPI_TOKEN": (self.CONFIG_BASE + "/PIWebAPIToken", ""),  # Should use password tags
                "PI_WEBAPI_AUTH_SCHEME": (self.CONFIG_BASE + "/PIWebAPIAuthScheme", "Basic"),
                "PI_WEBAPI_TIMEOUT_MS": (self.CONFIG_BASE + "/PIWebAPITimeoutMs", 5000),
                "PI_WEBAPI_INSECURE_OK": (self.CONFIG_BASE + "/PIWebAPIInsecureOK", False),

                # Actility
                "ACTILITY_MQTT_TLS_PORT": (self.CONFIG_BASE + "/ActilityMQTTTLSPort", 8883),
                "ACTILITY_HTTPS_PORT": (self.CONFIG_BASE + "/ActilityHTTPSPort", 443),
                "ACTILITY_REQUIRE_BOTH": (self.CONFIG_BASE + "/ActilityRequireBoth", False),

                # DMZ Listener
                "DMZ_LISTEN_HOST": (self.CONFIG_BASE + "/DMZListenHost", ""),
                "DMZ_LISTEN_TLS_PORT": (self.CONFIG_BASE + "/DMZListenTLSPort", 8883),
                "MQTT_SYS_ROOT_TAG": (self.CONFIG_BASE + "/MQTTSysRootTag", ""),
                "PI_ADAPTER_CLIENT_ID": (self.CONFIG_BASE + "/PIAdapterClientID", ""),

                # SiteSync UI
                "SITESYNC_UI_HOST": (self.CONFIG_BASE + "/SiteSyncUIHost", ""),
                "SITESYNC_UI_PORT": (self.CONFIG_BASE + "/SiteSyncUIPort", 8043),
                "SITESYNC_UI_EXTERNAL_IP": (self.CONFIG_BASE + "/SiteSyncUIExternalIP", ""),

                # Azure Event Hub
                "EVENTHUB_DEV_HOST": (self.CONFIG_BASE + "/EventHubDevHost", ""),
                "EVENTHUB_PROD_HOST": (self.CONFIG_BASE + "/EventHubProdHost", ""),
                "EVENTHUB_PORT": (self.CONFIG_BASE + "/EventHubPort", 5671),

                # Optional URLs
                "GEOEVENT_HEALTH_URL": (self.CONFIG_BASE + "/GeoEventHealthURL", ""),
                "AZURE_HEALTH_URL": (self.CONFIG_BASE + "/AzureHealthURL", ""),
            }

            # Read all config tags
            for attr, (tag_path, default) in config_map.items():
                try:
                    qv = system.tag.readBlocking([tag_path], 1000)[0]
                    if qv and qv.quality.isGood() and qv.value is not None:
                        setattr(self, attr, qv.value)
                    else:
                        setattr(self, attr, default)
                except Exception:
                    setattr(self, attr, default)

            # Load list configurations (IPs)
            self._load_ip_lists()

            _log("info", "Configuration loaded successfully")

        except Exception as ex:
            _log("error", "Failed to load configuration: %s" % ex)
            raise

    def _load_ip_lists(self):
        """Load IP address lists from JSON-encoded tags"""
        try:
            # Actility TPX IPs
            qv = system.tag.readBlocking([self.CONFIG_BASE + "/ActilityTPXIPs"], 1000)[0]
            if qv and qv.quality.isGood() and qv.value:
                import json
                self.ACTILITY_TPX_IPS = json.loads(str(qv.value))
            else:
                self.ACTILITY_TPX_IPS = ["18.210.115.231", "52.1.89.48", "54.81.224.96"]

            # Actility HTTPS IPs
            qv = system.tag.readBlocking([self.CONFIG_BASE + "/ActilityHTTPSIPs"], 1000)[0]
            if qv and qv.quality.isGood() and qv.value:
                import json
                self.ACTILITY_HTTPS_IPS = json.loads(str(qv.value))
            else:
                self.ACTILITY_HTTPS_IPS = ["10.102.12.10", "54.224.165.180", "10.102.22.10", "3.224.202.202"]

            # Actility CloudFront IPs
            qv = system.tag.readBlocking([self.CONFIG_BASE + "/ActilityCloudfrontIPs"], 1000)[0]
            if qv and qv.quality.isGood() and qv.value:
                import json
                self.ACTILITY_CLOUDFRONT_IPS = json.loads(str(qv.value))
            else:
                self.ACTILITY_CLOUDFRONT_IPS = [
                    "52.85.132.122","52.85.132.36","52.85.132.22","52.85.132.23",
                    "108.156.91.15","108.156.91.112","108.156.91.53","108.156.91.116",
                    "18.238.55.96","18.238.55.29","18.238.55.49","18.238.55.12",
                    "13.32.241.42","13.32.241.74","13.32.241.53","13.32.241.86",
                ]

            # Green DC IPs for LDAP
            qv = system.tag.readBlocking([self.CONFIG_BASE + "/GreenDCIPs"], 1000)[0]
            if qv and qv.quality.isGood() and qv.value:
                import json
                self.GREEN_DC_IPS = json.loads(str(qv.value))
            else:
                self.GREEN_DC_IPS = []

        except Exception as ex:
            _log("warn", "Failed to load IP lists: %s" % ex)
            # Use defaults set above

# Global config instance
CFG = None

# -------- Thread-safe cache --------
from threading import Lock

class ThreadSafeCache:
    """Thread-safe cache for ThingPark scan results"""
    def __init__(self):
        self.lock = Lock()
        self.data = {"t": 0, "newest": None, "count": 0}

    def get(self):
        with self.lock:
            return dict(self.data)

    def update(self, **kwargs):
        with self.lock:
            self.data.update(kwargs)

_tp_scan_cache = ThreadSafeCache()

# -------- Health rollup members --------
OVERALL_FOLDERS = [
    "ThingPark_Inbound",
    "MQTT_Broker",
    "MQTT_Transmission",
    "SiteSync_API",
    "PI_Adapter",
    "PI_Adapter_API",
    "PI_WebAPI",
    "GeoEvent",
    "Azure_Function",
    "Actility_API",
    "PI_Adapter_Link",
    "SiteSync_UI",
    "SiteSync_UI_External",
    "LDAP_Green",
    "Azure_EventHub_Dev",
    "Azure_EventHub_Prod",
]

# -------- Tag creation helpers --------

def _mem_tag(name, dtype, value, alarms=None):
    """Create memory tag configuration"""
    t = {
        "name": name,
        "tagType": "AtomicTag",
        "valueSource": "memory",
        "dataType": dtype,
        "value": value,
        "enabled": True
    }
    if alarms:
        t["alarms"] = alarms
    return t

def _ensure_base():
    """Ensure base Health folder structure exists"""
    try:
        base_cfg = [
            _mem_tag("ENABLE_UNIFIED_MONITOR", "Boolean", True),
            _mem_tag("Overall_Healthy", "Boolean", False),
            _mem_tag("Fault_Summary", "String", "Initializing..."),
            _mem_tag("Last_Fault", "String", ""),
            _mem_tag("Last_Fault_At", "DateTime", system.date.now()),
            _mem_tag("_PipelinesAttached", "Boolean", False),
            _mem_tag("ScriptExecutionMs", "Int4", -1),
            _mem_tag("LastExecutionTime", "DateTime", system.date.now()),
        ]
        system.tag.configure(CFG.HEALTH_BASE, base_cfg, "m")
        _log("info", "Base health tags ensured")

        # Create Config folder structure
        _ensure_config_folder()

        # Create health folders for each component
        for f in OVERALL_FOLDERS:
            _ensure_health_folder(f)

    except Exception as ex:
        _log("error", "Failed to ensure base tags: %s" % ex)
        raise

def _ensure_config_folder():
    """Create configuration folder structure"""
    try:
        config_folder = [{"name": "Config", "tagType": "Folder", "tags": []}]
        system.tag.configure(CFG.HEALTH_BASE, config_folder, "m")
    except Exception as ex:
        _log("warn", "Config folder creation issue: %s" % ex)

def _ensure_health_folder(folder_name):
    """Ensure individual health folder exists with all required tags"""
    now = system.date.now()
    alarms = [{
        "name": "ConnDown",
        "enabled": True,
        "priority": "High",
        "alarmMode": "Equal",
        "setpointA": False,
        "activePipeline": CFG.PIPELINE_NAME
    }]

    tags = [
        _mem_tag("IsHealthy", "Boolean", False, alarms),
        _mem_tag("Status", "String", "INIT"),
        _mem_tag("Message", "String", ""),
        _mem_tag("LatencyMs", "Int4", -1),
        _mem_tag("LastCheck", "DateTime", now),
        _mem_tag("LastOK", "DateTime", now),
    ]

    # Special tags for specific folders
    if folder_name == "ThingPark_Inbound":
        tags.append(_mem_tag("LastInboundMs", "Int8", 0))
    if folder_name == "MQTT_Broker":
        tags.append(_mem_tag("Clients", "Int4", -1))

    folder = [{"name": folder_name, "tagType": "Folder", "tags": tags}]

    try:
        system.tag.configure(CFG.HEALTH_BASE, folder, "m")
    except Exception as ex:
        # Retry without alarms if there's an issue
        _log("warn", "Alarm config failed for %s, retrying without alarms: %s" % (folder_name, ex))
        folder[0]["tags"][0].pop("alarms", None)
        try:
            system.tag.configure(CFG.HEALTH_BASE, folder, "m")
        except Exception as ex2:
            _log("error", "Failed to create health folder %s: %s" % (folder_name, ex2))

def _attach_pipeline_once():
    """Attach alarm pipeline to all IsHealthy tags (one-time operation)"""
    try:
        q = system.tag.readBlocking([CFG.HEALTH_BASE + "/_PipelinesAttached"], 1000)[0]
        if q and q.quality.isGood() and bool(q.value):
            return  # Already attached
    except Exception:
        pass

    try:
        br = system.tag.browse(CFG.HEALTH_BASE, {"recursive": True})
        for r in br.getResults():
            fp = str(r.get("fullPath", ""))
            if fp.endswith("/IsHealthy") and str(r.get("tagType", "")) == "AtomicTag":
                try:
                    cfg = system.tag.getConfiguration(fp, True)
                    if not cfg:
                        continue
                    alarms = cfg[0].get("alarms") or []
                    changed = False
                    for a in alarms:
                        if a.get("name") == "ConnDown":
                            if "pipelines" in a:
                                pl = set(a.get("pipelines") or [])
                                if CFG.PIPELINE_NAME not in pl:
                                    pl.add(CFG.PIPELINE_NAME)
                                    a["pipelines"] = list(pl)
                                    changed = True
                            else:
                                if a.get("activePipeline") != CFG.PIPELINE_NAME:
                                    a["activePipeline"] = CFG.PIPELINE_NAME
                                    changed = True
                    if changed:
                        system.tag.configure(fp, cfg, "m")
                except Exception as ex:
                    _log("warn", "Failed to attach pipeline to %s: %s" % (fp, ex))

        system.tag.writeBlocking([CFG.HEALTH_BASE + "/_PipelinesAttached"], [True])
        _log("info", "Alarm pipelines attached successfully")

    except Exception as ex:
        _log("error", "Failed to attach pipelines: %s" % ex)

# -------- Tag write helpers --------

def _set(folder, ok, msg, latency_ms):
    """Write health status to folder tags"""
    base = CFG.HEALTH_BASE + "/" + folder
    paths = [
        base + "/IsHealthy",
        base + "/Status",
        base + "/Message",
        base + "/LatencyMs",
        base + "/LastCheck"
    ]
    vals = [
        bool(ok),
        ("OK" if ok else "BAD"),
        (str(msg)[:4000] if msg else ""),
        int(latency_ms) if latency_ms is not None else -1,
        system.date.now()
    ]

    try:
        system.tag.writeBlocking(paths, vals)
        if ok:
            system.tag.writeBlocking([base + "/LastOK"], [system.date.now()])
    except Exception as ex:
        _log("warn", "Failed to write status for %s: %s" % (folder, ex))

def _maybe_bump_counter():
    """Increment legacy counter tag"""
    try:
        qv = system.tag.readBlocking([CFG.COUNTER_TAG], 1000)[0]
        cur = int(qv.value or 0)
    except Exception:
        # Create counter tag if missing
        base, name = CFG.COUNTER_TAG.rsplit("/", 1)
        cfg = [_mem_tag(name, "Int4", 0)]
        try:
            system.tag.configure(base, cfg, "m")
        except Exception as ex:
            _log("warn", "Failed to create counter tag: %s" % ex)
        cur = 0

    try:
        system.tag.writeBlocking([CFG.COUNTER_TAG], [cur + 1])
    except Exception as ex:
        _log("warn", "Failed to bump counter: %s" % ex)

# -------- Network probe functions with retry --------

def _tcp(host, port, timeout=3.0, retries=2):
    """TCP socket connectivity test with retry logic"""
    for attempt in range(retries + 1):
        t0 = time.time()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((host, int(port)))
            s.close()
            ms = int((time.time() - t0) * 1000)
            return True, ms
        except socket.timeout:
            if attempt < retries:
                time.sleep(0.5 * (2 ** attempt))  # Exponential backoff
                continue
            return False, -1
        except Exception as ex:
            _log("debug", "TCP connect failed to %s:%s - %s" % (host, port, ex))
            return False, -1
        finally:
            try:
                s.close()
            except Exception:
                pass
    return False, -1

def _http(url, timeout_ms=5000, headers=None, username=None, password=None, insecure=False):
    """HTTP/HTTPS endpoint check with enhanced error handling"""
    t0 = system.date.now()

    # Try newer httpClient first
    try:
        client = system.net.httpClient()
        kwargs = {
            "connectTimeout": timeout_ms,
            "readTimeout": timeout_ms
        }
        if headers:
            kwargs["headers"] = headers
        if username is not None:
            kwargs["username"] = username
        if password is not None:
            kwargs["password"] = password

        resp = client.get(url, **kwargs)
        ms = system.date.millisBetween(t0, system.date.now())
        code = int(resp.getStatusCode())

        if 200 <= code < 300:
            return True, ms, "HTTP %d" % code
        else:
            return False, ms, "HTTP %d" % code

    except AttributeError:
        # httpClient not available, fall back to httpGet
        pass
    except Exception as ex:
        ms = system.date.millisBetween(t0, system.date.now())
        err_msg = "%s: %s" % (ex.__class__.__name__, str(ex))
        _log("debug", "HTTP request failed to %s - %s" % (url, err_msg))
        return False, ms, err_msg[:500]

    # Fallback to legacy httpGet
    try:
        body = system.net.httpGet(
            url,
            timeout_ms,
            timeout_ms,
            None,
            username or None,
            password or None,
            bool(insecure)
        )
        ms = system.date.millisBetween(t0, system.date.now())
        return True, ms, "OK (len=%d)" % len(body or "")
    except Exception as ex:
        ms = system.date.millisBetween(t0, system.date.now())
        err_msg = "%s: %s" % (ex.__class__.__name__, str(ex))
        _log("debug", "HTTP fallback failed to %s - %s" % (url, err_msg))
        return False, ms, err_msg[:500]

def _bool_tag(path):
    """Read boolean tag value safely"""
    try:
        q = system.tag.readBlocking([path], 1000)[0]
        return q.quality.isGood() and bool(q.value)
    except Exception:
        return None

# -------- Component-specific health checks --------

def _newest_device_timestamp():
    """Find newest ThingPark device timestamp with caching"""
    now_ms = system.date.toMillis(system.date.now())
    cached = _tp_scan_cache.get()

    # Return cached result if recent
    if now_ms - cached["t"] < CFG.TP_SCAN_MIN_MS:
        return cached["newest"], cached["count"]

    try:
        # Browse all device timestamp tags
        res = system.tag.browse(CFG.DEVICES_ROOT, {"recursive": True})
        paths = []
        for r in res.getResults():
            fp = str(r.get("fullPath", ""))
            if fp.endswith(CFG.TIMESTAMP_TAG_SUFFIX):
                paths.append(fp)

        if not paths:
            _tp_scan_cache.update(t=now_ms, newest=None, count=0)
            return None, 0

        # Read all timestamps
        qv = system.tag.readBlocking(paths)
        newest = None
        for q in qv:
            if not q or not q.quality.isGood() or q.value is None:
                continue
            try:
                ms = system.date.toMillis(q.value)
                if newest is None or ms > newest:
                    newest = ms
            except Exception as ex:
                _log("debug", "Failed to parse timestamp: %s" % ex)
                continue

        _tp_scan_cache.update(t=now_ms, newest=newest, count=len(paths))
        return newest, len(paths)

    except Exception as ex:
        _log("warn", "ThingPark timestamp scan failed: %s" % ex)
        _tp_scan_cache.update(t=now_ms, newest=None, count=0)
        return None, 0

def _sitesync_api():
    """Test SiteSync API connectivity"""
    t0 = system.date.now()

    # Try to import project helper module
    mod = None
    candidates = [
        "connections.networkserver.code",
        "network",
        "sitesync",
        "siteSyncNetwork",
        "tp",
        "joinserver",
    ]

    for mod_name in candidates:
        try:
            mod = __import__("project.%s" % mod_name, fromlist=["*"])
            if hasattr(mod, "testAPI"):
                break
        except Exception:
            continue

    if mod and hasattr(mod, "testAPI"):
        try:
            res = mod.testAPI(CFG.SITESYNC_TENANT_ID)
            ms = system.date.millisBetween(t0, system.date.now())
            txt = "" if res is None else str(res)
            ok = bool(res) and ("error" not in txt.lower())
            return ok, ms, ("OK" if ok else txt[:4000])
        except Exception as ex:
            ms = system.date.millisBetween(t0, system.date.now())
            _log("warn", "SiteSync API test failed: %s" % ex)
            return False, ms, str(ex)[:500]

    # Fallback to system function if available
    try:
        raw = system.sitesync.testJoinAPIImpl(CFG.SITESYNC_TENANT_ID)
        ms = system.date.millisBetween(t0, system.date.now())
        txt = "" if raw is None else str(raw)
        ok = bool(raw) and ("error" not in txt.lower())
        return ok, ms, ("OK" if ok else txt[:4000])
    except Exception as ex:
        ms = system.date.millisBetween(t0, system.date.now())
        _log("warn", "SiteSync API fallback failed: %s" % ex)
        return False, ms, str(ex)[:500]

def _actility_tcp():
    """Test Actility endpoint reachability (MQTT + HTTPS)"""
    mqtt_good, https_good = 0, 0
    best_ms = None

    # Test TPX MQTT endpoints
    for ip in CFG.ACTILITY_TPX_IPS:
        ok, ms = _tcp(ip, CFG.ACTILITY_MQTT_TLS_PORT, timeout=2.0, retries=1)
        if ok:
            mqtt_good += 1
            if best_ms is None or (0 <= ms < best_ms):
                best_ms = ms

    # Test HTTPS endpoints
    all_https_ips = CFG.ACTILITY_HTTPS_IPS + CFG.ACTILITY_CLOUDFRONT_IPS
    for ip in all_https_ips:
        ok, ms = _tcp(ip, CFG.ACTILITY_HTTPS_PORT, timeout=2.0, retries=1)
        if ok:
            https_good += 1
            if best_ms is None or (0 <= ms < best_ms):
                best_ms = ms

    mqtt_ok = mqtt_good > 0
    https_ok = https_good > 0

    overall = (mqtt_ok and https_ok) if CFG.ACTILITY_REQUIRE_BOTH else (mqtt_ok or https_ok)

    msg = "TPX 8883: %d/%d up; HTTPS 443: %d/%d up" % (
        mqtt_good, len(CFG.ACTILITY_TPX_IPS),
        https_good, len(all_https_ips)
    )

    return overall, (best_ms if best_ms is not None else -1), msg

def _pi_adapter_link():
    """Test PI Adapter connection to DMZ MQTT listener"""
    if not CFG.DMZ_LISTEN_HOST:
        return True, -1, "Skipped: DMZ_LISTEN_HOST not configured"

    ok, ms = _tcp(CFG.DMZ_LISTEN_HOST, CFG.DMZ_LISTEN_TLS_PORT)

    if not ok:
        return False, ms, "DMZ 8883 not listening @ %s:%s" % (
            CFG.DMZ_LISTEN_HOST, CFG.DMZ_LISTEN_TLS_PORT
        )

    # Optional: Check if specific client is connected via $SYS topic
    if CFG.PI_ADAPTER_CLIENT_ID and CFG.MQTT_SYS_ROOT_TAG:
        path = CFG.MQTT_SYS_ROOT_TAG + "/clients/" + CFG.PI_ADAPTER_CLIENT_ID + "/connected"
        try:
            q = system.tag.readBlocking([path], 1000)[0]
            if q and q.quality.isGood():
                try:
                    val = int(q.value)
                except Exception:
                    val = 1 if bool(q.value) else 0

                if val >= 1:
                    return True, ms, "DMZ 8883 listening; client %s connected" % CFG.PI_ADAPTER_CLIENT_ID
                else:
                    return False, ms, "DMZ 8883 listening; client %s NOT connected" % CFG.PI_ADAPTER_CLIENT_ID
        except Exception as ex:
            _log("warn", "$SYS client check failed: %s" % ex)

    return True, ms, "DMZ 8883 listening @ %s:%s" % (CFG.DMZ_LISTEN_HOST, CFG.DMZ_LISTEN_TLS_PORT)

def _pi_adapter_api_health():
    """Test PI Adapter API endpoint"""
    if not CFG.PI_ADAPTER_API_URL:
        return True, -1, "Skipped: PI_ADAPTER_API_URL not configured"

    try:
        ok, ms, msg = _http(CFG.PI_ADAPTER_API_URL, timeout_ms=4000)
        return ok, ms, msg
    except Exception as ex:
        _log("warn", "PI Adapter API check failed: %s" % ex)
        return False, -1, str(ex)[:500]

def _pi_webapi_health():
    """Test PI Web API endpoint with authentication"""
    if not CFG.PI_WEBAPI_BASE:
        return True, -1, "Skipped: PI_WEBAPI_BASE not configured"

    url = CFG.PI_WEBAPI_BASE.rstrip("/") + CFG.PI_WEBAPI_ENDPOINT
    headers = {"Accept": "application/json"}

    # Use token if configured
    if CFG.PI_WEBAPI_TOKEN:
        scheme = CFG.PI_WEBAPI_AUTH_SCHEME.strip()
        if scheme.lower() == "bearer":
            headers["Authorization"] = "Bearer " + CFG.PI_WEBAPI_TOKEN
        else:
            headers["Authorization"] = "Basic " + CFG.PI_WEBAPI_TOKEN

        return _http(
            url,
            timeout_ms=CFG.PI_WEBAPI_TIMEOUT_MS,
            headers=headers,
            insecure=bool(CFG.PI_WEBAPI_INSECURE_OK)
        )

    # Fall back to username/password
    return _http(
        url,
        timeout_ms=CFG.PI_WEBAPI_TIMEOUT_MS,
        username=CFG.PI_WEBAPI_USER or None,
        password=CFG.PI_WEBAPI_PASS or None,
        insecure=bool(CFG.PI_WEBAPI_INSECURE_OK)
    )

def _update_fault_and_overall():
    """Aggregate all health statuses and update rollup tags"""
    paths = []
    for f in OVERALL_FOLDERS:
        paths.append(CFG.HEALTH_BASE + "/" + f + "/IsHealthy")
        paths.append(CFG.HEALTH_BASE + "/" + f + "/Message")

    try:
        qv = system.tag.readBlocking(paths, 2000)
    except Exception as ex:
        _log("error", "Failed to read health statuses: %s" % ex)
        return

    bad = []
    for i, f in enumerate(OVERALL_FOLDERS):
        qh = qv[2 * i]
        qm = qv[2 * i + 1]

        ok = qh is not None and qh.quality.isGood() and bool(qh.value)

        if not ok:
            msg = ""
            try:
                if qm and qm.quality.isGood() and qm.value:
                    msg = str(qm.value)
            except Exception:
                pass
            bad.append(f + ": " + (msg or "No details"))

    try:
        if bad:
            fault_summary = "; ".join(bad)[:4000]
            system.tag.writeBlocking(
                [
                    CFG.HEALTH_BASE + "/Fault_Summary",
                    CFG.HEALTH_BASE + "/Last_Fault",
                    CFG.HEALTH_BASE + "/Last_Fault_At"
                ],
                [fault_summary, bad[0][:4000], system.date.now()]
            )
        else:
            system.tag.writeBlocking(
                [CFG.HEALTH_BASE + "/Fault_Summary"],
                ["All systems healthy"]
            )

        system.tag.writeBlocking(
            [CFG.HEALTH_BASE + "/Overall_Healthy"],
            [not bool(bad)]
        )

    except Exception as ex:
        _log("error", "Failed to update fault summary: %s" % ex)

# -------- Parallel execution helpers --------

class HealthCheckCallable(Callable):
    """Callable wrapper for health check functions"""
    def __init__(self, name, func):
        self.name = name
        self.func = func

    def call(self):
        try:
            return self.name, self.func()
        except Exception as ex:
            _log("error", "Health check %s failed: %s" % (self.name, ex))
            return self.name, (False, -1, str(ex)[:500])

def _run_checks_parallel():
    """Execute all health checks in parallel using thread pool"""
    executor = Executors.newFixedThreadPool(8)

    try:
        # Define all health check tasks
        tasks = []

        # ThingPark Inbound
        def check_thingpark():
            newest_ms, count = _newest_device_timestamp()
            if newest_ms is None:
                return False, -1, "No device timestamps found", 0
            now_ms = system.date.toMillis(system.date.now())
            age_ms = now_ms - newest_ms
            ok = age_ms < CFG.TP_STALE_MS
            msg = "" if ok else "No uplink in %ds (checked %d devices)" % (age_ms / 1000, count)
            return ok, age_ms / 1000, msg, newest_ms

        tasks.append(HealthCheckCallable("ThingPark_Inbound", check_thingpark))

        # MQTT Transmission
        def check_mqtt_tx():
            mt = _bool_tag(CFG.MQTT_TX_STATUS_TAG) if CFG.MQTT_TX_STATUS_TAG else None
            if mt is not None:
                return mt, -1, "" if mt else "Transmission reported down"
            return None, -1, "Tag not configured"

        tasks.append(HealthCheckCallable("MQTT_Transmission", check_mqtt_tx))

        # MQTT Broker
        def check_mqtt_broker():
            ok, ms = _tcp(CFG.BROKER_HOST, CFG.BROKER_PORT)
            return ok, ms, "" if ok else "TCP connect failed"

        tasks.append(HealthCheckCallable("MQTT_Broker", check_mqtt_broker))

        # SiteSync API
        tasks.append(HealthCheckCallable("SiteSync_API", _sitesync_api))

        # PI Adapter
        def check_pi_adapter():
            if not CFG.PI_ADAPTER_BASE:
                return True, -1, "Skipped: not configured"
            url = CFG.PI_ADAPTER_BASE.rstrip("/") + "/system/status"
            return _http(url, timeout_ms=4000)

        tasks.append(HealthCheckCallable("PI_Adapter", check_pi_adapter))

        # PI Adapter API
        tasks.append(HealthCheckCallable("PI_Adapter_API", _pi_adapter_api_health))

        # PI Web API
        tasks.append(HealthCheckCallable("PI_WebAPI", _pi_webapi_health))

        # GeoEvent
        def check_geoevent():
            if not CFG.GEOEVENT_HEALTH_URL:
                return True, -1, "Skipped: not configured"
            return _http(CFG.GEOEVENT_HEALTH_URL, timeout_ms=4000)

        tasks.append(HealthCheckCallable("GeoEvent", check_geoevent))

        # Azure Function
        def check_azure_func():
            if not CFG.AZURE_HEALTH_URL:
                return True, -1, "Skipped: not configured"
            return _http(CFG.AZURE_HEALTH_URL, timeout_ms=4000)

        tasks.append(HealthCheckCallable("Azure_Function", check_azure_func))

        # Actility API
        tasks.append(HealthCheckCallable("Actility_API", _actility_tcp))

        # PI Adapter Link
        tasks.append(HealthCheckCallable("PI_Adapter_Link", _pi_adapter_link))

        # SiteSync UI Internal
        def check_ui_internal():
            if not CFG.SITESYNC_UI_HOST:
                return True, -1, "Skipped: not configured"
            ok, ms = _tcp(CFG.SITESYNC_UI_HOST, CFG.SITESYNC_UI_PORT)
            msg = "UI @ %s:%s" % (CFG.SITESYNC_UI_HOST, CFG.SITESYNC_UI_PORT)
            return ok, ms, msg if ok else "TCP connect failed"

        tasks.append(HealthCheckCallable("SiteSync_UI", check_ui_internal))

        # SiteSync UI External
        def check_ui_external():
            if not CFG.SITESYNC_UI_EXTERNAL_IP:
                return True, -1, "Skipped: not configured"
            ok, ms = _tcp(CFG.SITESYNC_UI_EXTERNAL_IP, CFG.SITESYNC_UI_PORT)
            msg = "UI @ %s:%s" % (CFG.SITESYNC_UI_EXTERNAL_IP, CFG.SITESYNC_UI_PORT)
            return ok, ms, msg if ok else "TCP connect failed"

        tasks.append(HealthCheckCallable("SiteSync_UI_External", check_ui_external))

        # LDAP Green DCs
        def check_ldap():
            if not CFG.GREEN_DC_IPS:
                return True, -1, "Skipped: not configured"
            good = 0
            best_ms = None
            for ip in CFG.GREEN_DC_IPS:
                ok, ms = _tcp(ip, 636, timeout=2.0)
                if ok:
                    good += 1
                    if best_ms is None or (0 <= ms < best_ms):
                        best_ms = ms
            overall = good > 0
            msg = "636 up %d/%d DCs" % (good, len(CFG.GREEN_DC_IPS))
            return overall, (best_ms if best_ms else -1), msg

        tasks.append(HealthCheckCallable("LDAP_Green", check_ldap))

        # Azure Event Hub Dev
        def check_eventhub_dev():
            if not CFG.EVENTHUB_DEV_HOST:
                return True, -1, "Skipped: not configured"
            ok, ms = _tcp(CFG.EVENTHUB_DEV_HOST, CFG.EVENTHUB_PORT)
            msg = "5671 @ %s" % CFG.EVENTHUB_DEV_HOST
            return ok, ms, msg if ok else "TCP connect failed"

        tasks.append(HealthCheckCallable("Azure_EventHub_Dev", check_eventhub_dev))

        # Azure Event Hub Prod
        def check_eventhub_prod():
            if not CFG.EVENTHUB_PROD_HOST:
                return True, -1, "Skipped: not configured"
            ok, ms = _tcp(CFG.EVENTHUB_PROD_HOST, CFG.EVENTHUB_PORT)
            msg = "5671 @ %s" % CFG.EVENTHUB_PROD_HOST
            return ok, ms, msg if ok else "TCP connect failed"

        tasks.append(HealthCheckCallable("Azure_EventHub_Prod", check_eventhub_prod))

        # Submit all tasks
        futures = [executor.submit(task) for task in tasks]

        # Wait for completion (max 30 seconds)
        results = {}
        for future in futures:
            try:
                result = future.get(30, TimeUnit.SECONDS)
                if result:
                    results[result[0]] = result[1]
            except Exception as ex:
                _log("warn", "Task execution failed: %s" % ex)

        return results

    finally:
        executor.shutdown()

# -------- MAIN EXECUTION --------

def main():
    """Main health monitor execution"""
    script_start = time.time()

    try:
        # Load configuration
        global CFG
        CFG = Config()

        # Ensure tag structure
        _ensure_base()
        _attach_pipeline_once()

        # Check run gate
        try:
            qg = system.tag.readBlocking([CFG.HEALTH_BASE + "/ENABLE_UNIFIED_MONITOR"], 1000)[0]
            if not (qg and qg.quality.isGood() and bool(qg.value)):
                _log("info", "Health monitor disabled via run gate")
                _maybe_bump_counter()
                return
        except Exception as ex:
            _log("warn", "Run gate check failed: %s" % ex)

        _maybe_bump_counter()

        # Execute all checks in parallel
        _log("info", "Starting parallel health checks")
        results = _run_checks_parallel()

        # Process results and update tags
        for name, result in results.items():
            try:
                if name == "ThingPark_Inbound" and len(result) == 4:
                    ok, latency, msg, newest_ms = result
                    _set(name, ok, msg, latency)
                    system.tag.writeBlocking(
                        [CFG.HEALTH_BASE + "/ThingPark_Inbound/LastInboundMs"],
                        [int(newest_ms)]
                    )
                elif name == "MQTT_Transmission":
                    mt, latency, msg = result
                    if mt is not None:
                        _set(name, mt, msg, latency)
                    else:
                        # Fall back to broker status
                        broker_result = results.get("MQTT_Broker")
                        if broker_result:
                            ok, ms, _ = broker_result
                            _set(name, ok, "Using broker reachability" if ok else msg, ms)
                else:
                    ok, latency, msg = result
                    _set(name, ok, msg, latency)
            except Exception as ex:
                _log("error", "Failed to process result for %s: %s" % (name, ex))

        # Update rollup
        _update_fault_and_overall()

        # Record execution time
        exec_ms = int((time.time() - script_start) * 1000)
        system.tag.writeBlocking(
            [CFG.HEALTH_BASE + "/ScriptExecutionMs", CFG.HEALTH_BASE + "/LastExecutionTime"],
            [exec_ms, system.date.now()]
        )

        _log("info", "Health monitor completed in %d ms" % exec_ms)

    except Exception as ex:
        _log("error", "Unified monitor failure: %r" % ex)
        import traceback
        _log("error", traceback.format_exc())

# Execute main
try:
    main()
except SystemExit:
    pass
except Exception as e:
    _log("error", "Top-level exception: %r" % e)
