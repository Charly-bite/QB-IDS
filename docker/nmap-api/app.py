"""
Nmap REST API Wrapper — v2 with Progress Tracking
Exposes Nmap scanning via a simple REST API for the QB Control Panel.

Endpoints:
  GET  /health           — Health check
  POST /scan             — Start a scan (async)
  GET  /scan/:id         — Get scan results + progress
  POST /scan/:id/cancel  — Cancel a running scan
  GET  /scans            — List all scans
  GET  /quick/:ip        — Quick single-host scan (sync)
  GET  /discover/:subnet — Subnet discovery sweep
"""

import json
import uuid
import threading
import time
import subprocess
import ipaddress
from datetime import datetime
from flask import Flask, request, jsonify
import nmap

app = Flask(__name__)

# In-memory scan results store (keyed by scan_id)
scans: dict = {}
MAX_STORED_SCANS = 50

# Track cancellation requests
cancel_flags: dict = {}


def estimate_total_hosts(target: str) -> int:
    """Estimate total hosts in a target range for progress calculation."""
    try:
        if "/" in target:
            network = ipaddress.ip_network(target, strict=False)
            return min(network.num_addresses, 256)  # Cap at /24
        elif "-" in target:
            return 256  # Rough estimate for ranges
        else:
            return 1
    except Exception:
        return 1


def parse_host_result(nm, host):
    """Parse nmap results for a single host into our standard format."""
    host_data = {
        "ip": host,
        "hostname": nm[host].hostname() or None,
        "state": nm[host].state(),
        "os_matches": [],
        "ports": [],
        "mac_address": None,
        "vendor": None,
    }

    # OS detection results
    if "osmatch" in nm[host]:
        for os_match in nm[host]["osmatch"][:5]:
            host_data["os_matches"].append({
                "name": os_match.get("name", ""),
                "accuracy": int(os_match.get("accuracy", 0)),
                "os_family": os_match["osclass"][0].get("osfamily", "") if os_match.get("osclass") else "",
                "os_gen": os_match["osclass"][0].get("osgen", "") if os_match.get("osclass") else "",
                "vendor": os_match["osclass"][0].get("vendor", "") if os_match.get("osclass") else "",
                "type": os_match["osclass"][0].get("type", "") if os_match.get("osclass") else "",
            })

    # MAC address and vendor
    if "addresses" in nm[host] and "mac" in nm[host]["addresses"]:
        host_data["mac_address"] = nm[host]["addresses"]["mac"]
    if "vendor" in nm[host] and nm[host]["vendor"]:
        first_mac = list(nm[host]["vendor"].keys())[0] if nm[host]["vendor"] else None
        if first_mac:
            host_data["vendor"] = nm[host]["vendor"][first_mac]

    # Open ports and services
    for proto in nm[host].all_protocols():
        for port in sorted(nm[host][proto].keys()):
            port_info = nm[host][proto][port]
            host_data["ports"].append({
                "port": port,
                "protocol": proto,
                "state": port_info.get("state", ""),
                "service": port_info.get("name", ""),
                "version": port_info.get("version", ""),
                "product": port_info.get("product", ""),
                "extra_info": port_info.get("extrainfo", ""),
            })

    return host_data


def run_scan(scan_id: str, target: str, arguments: str, scan_type: str):
    """
    Run an nmap scan with progress tracking.
    
    Strategy:
      1. Do a quick ping sweep (-sn) to discover live hosts
      2. Scan each live host individually with the requested flags
      3. Report progress after each host completes
    
    For 'quick' scans (ping sweep only), skip step 2.
    """
    scans[scan_id]["status"] = "running"
    scans[scan_id]["started_at"] = datetime.now().isoformat()
    scans[scan_id]["progress"] = 0
    scans[scan_id]["progress_message"] = "Starting scan..."
    scans[scan_id]["results"] = []
    scans[scan_id]["hosts_scanned"] = 0
    scans[scan_id]["hosts_total"] = 0
    scans[scan_id]["errors_list"] = []

    try:
        nm = nmap.PortScanner()

        # ── Phase 1: Discovery (ping sweep) ──
        scans[scan_id]["progress_message"] = "Phase 1: Discovering live hosts..."
        scans[scan_id]["progress"] = 2

        if cancel_flags.get(scan_id):
            scans[scan_id]["status"] = "cancelled"
            scans[scan_id]["completed_at"] = datetime.now().isoformat()
            return

        nm.scan(hosts=target, arguments="-sn -T4")
        live_hosts = sorted(nm.all_hosts(), key=lambda x: [int(p) for p in x.split(".")])

        # For ping sweep only, we're done
        if scan_type == "quick":
            results = []
            for host in live_hosts:
                host_data = {
                    "ip": host,
                    "hostname": nm[host].hostname() or None,
                    "state": nm[host].state(),
                    "os_matches": [],
                    "ports": [],
                    "mac_address": None,
                    "vendor": None,
                }
                if "addresses" in nm[host] and "mac" in nm[host]["addresses"]:
                    host_data["mac_address"] = nm[host]["addresses"]["mac"]
                if "vendor" in nm[host] and nm[host]["vendor"]:
                    first_mac = list(nm[host]["vendor"].keys())[0]
                    host_data["vendor"] = nm[host]["vendor"][first_mac]
                results.append(host_data)

            scans[scan_id]["status"] = "completed"
            scans[scan_id]["completed_at"] = datetime.now().isoformat()
            scans[scan_id]["results"] = results
            scans[scan_id]["host_count"] = len(results)
            scans[scan_id]["hosts_scanned"] = len(results)
            scans[scan_id]["hosts_total"] = len(results)
            scans[scan_id]["progress"] = 100
            scans[scan_id]["progress_message"] = f"Complete — {len(results)} hosts found"
            scans[scan_id]["command"] = nm.command_line()
            return

        # ── Phase 2: Deep scan each host individually ──
        total_hosts = len(live_hosts)
        scans[scan_id]["hosts_total"] = total_hosts
        scans[scan_id]["progress"] = 5
        scans[scan_id]["progress_message"] = f"Found {total_hosts} live hosts. Starting deep scan..."

        if total_hosts == 0:
            scans[scan_id]["status"] = "completed"
            scans[scan_id]["completed_at"] = datetime.now().isoformat()
            scans[scan_id]["host_count"] = 0
            scans[scan_id]["progress"] = 100
            scans[scan_id]["progress_message"] = "No live hosts found"
            return

        results = []
        for idx, host in enumerate(live_hosts):
            # Check for cancellation
            if cancel_flags.get(scan_id):
                scans[scan_id]["status"] = "cancelled"
                scans[scan_id]["completed_at"] = datetime.now().isoformat()
                scans[scan_id]["progress_message"] = f"Cancelled after {idx}/{total_hosts} hosts"
                scans[scan_id]["results"] = results
                scans[scan_id]["host_count"] = len(results)
                return

            # Update progress
            progress = 5 + int((idx / total_hosts) * 90)  # 5-95%
            elapsed = (datetime.now() - datetime.fromisoformat(scans[scan_id]["started_at"])).total_seconds()
            eta = ""
            if idx > 0:
                per_host = elapsed / idx
                remaining = per_host * (total_hosts - idx)
                if remaining > 60:
                    eta = f" — ETA: {int(remaining / 60)}m {int(remaining % 60)}s"
                else:
                    eta = f" — ETA: {int(remaining)}s"

            scans[scan_id]["progress"] = progress
            scans[scan_id]["hosts_scanned"] = idx
            scans[scan_id]["progress_message"] = f"Scanning {host} ({idx + 1}/{total_hosts}){eta}"
            scans[scan_id]["elapsed_seconds"] = int(elapsed)

            try:
                # Scan individual host with timeout (max 120s per host)
                host_nm = nmap.PortScanner()
                host_nm.scan(hosts=host, arguments=f"{arguments} --host-timeout 120s")

                if host in host_nm.all_hosts():
                    host_data = parse_host_result(host_nm, host)
                    results.append(host_data)
                    # Update results in real-time
                    scans[scan_id]["results"] = results
                    scans[scan_id]["host_count"] = len(results)
                else:
                    # Host didn't respond during deep scan
                    scans[scan_id]["errors_list"].append({
                        "host": host,
                        "error": "No response during deep scan (timeout)"
                    })

            except Exception as e:
                scans[scan_id]["errors_list"].append({
                    "host": host,
                    "error": str(e)[:200]
                })

        # ── Done ──
        elapsed = (datetime.now() - datetime.fromisoformat(scans[scan_id]["started_at"])).total_seconds()
        scans[scan_id]["status"] = "completed"
        scans[scan_id]["completed_at"] = datetime.now().isoformat()
        scans[scan_id]["results"] = results
        scans[scan_id]["host_count"] = len(results)
        scans[scan_id]["hosts_scanned"] = total_hosts
        scans[scan_id]["progress"] = 100
        scans[scan_id]["elapsed_seconds"] = int(elapsed)
        scans[scan_id]["progress_message"] = f"Complete — {len(results)} hosts scanned in {int(elapsed / 60)}m {int(elapsed % 60)}s"
        
        try:
            scans[scan_id]["command"] = arguments
        except Exception:
            pass

    except Exception as e:
        scans[scan_id]["status"] = "error"
        scans[scan_id]["error"] = str(e)
        scans[scan_id]["completed_at"] = datetime.now().isoformat()
        scans[scan_id]["progress"] = 0
        scans[scan_id]["progress_message"] = f"Error: {str(e)[:200]}"

    finally:
        # Cleanup cancel flag
        cancel_flags.pop(scan_id, None)

    # Cleanup old scans
    if len(scans) > MAX_STORED_SCANS:
        oldest_keys = sorted(scans.keys(), key=lambda k: scans[k].get("started_at", ""))[:10]
        for k in oldest_keys:
            del scans[k]


@app.route("/health")
def health():
    """Health check endpoint."""
    try:
        nm = nmap.PortScanner()
        version = nm.nmap_version()
        return jsonify({
            "status": "ok",
            "nmap_version": f"{version[0]}.{version[1]}",
            "active_scans": sum(1 for s in scans.values() if s.get("status") == "running"),
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/scan", methods=["POST"])
def start_scan():
    """
    Start an async nmap scan with progress tracking.

    JSON body:
      target: str — IP, hostname, or CIDR subnet (required)
      flags: str — nmap flags (default: "-sV -O -T4")
      scan_type: str — "quick", "full", "os", "vuln" (presets)
    """
    data = request.get_json(force=True, silent=True) or {}
    target = data.get("target", "").strip()

    if not target:
        return jsonify({"error": "target is required"}), 400

    # Prevent scanning external IPs (safety)
    if not any(target.startswith(prefix) for prefix in [
        "192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
        "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.",
        "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
        "127.", "localhost"
    ]):
        return jsonify({"error": "Only private/local network targets allowed"}), 403

    # Check if there's already a running scan
    running = [s for s in scans.values() if s.get("status") == "running"]
    if running:
        return jsonify({
            "error": "A scan is already running. Cancel it first or wait for completion.",
            "running_scan": running[0].get("id"),
        }), 409

    # Scan type presets
    scan_type = data.get("scan_type", "full")
    presets = {
        "quick": "-sn -T4",                          # Ping sweep only
        "ports": "-sS -T4 --top-ports 100",          # Top 100 ports
        "full": "-sV -O -T4 --top-ports 1000",       # Service + OS detection
        "os": "-O -T4",                               # OS detection only
        "aggressive": "-A -T4 --top-ports 1000",      # Everything
        "vuln": "-sV --script=vuln -T4 --top-ports 100",  # Vulnerability scan
    }

    flags = data.get("flags") or presets.get(scan_type, presets["full"])

    scan_id = str(uuid.uuid4())[:8]
    scans[scan_id] = {
        "id": scan_id,
        "target": target,
        "flags": flags,
        "scan_type": scan_type,
        "status": "queued",
        "created_at": datetime.now().isoformat(),
        "progress": 0,
        "progress_message": "Queued...",
        "hosts_scanned": 0,
        "hosts_total": 0,
        "results": [],
        "errors_list": [],
    }

    thread = threading.Thread(
        target=run_scan,
        args=(scan_id, target, flags, scan_type),
        daemon=True
    )
    thread.start()

    return jsonify({
        "scan_id": scan_id,
        "target": target,
        "scan_type": scan_type,
        "status": "queued",
    }), 202


@app.route("/scan/<scan_id>")
def get_scan(scan_id):
    """Get scan results + progress by ID."""
    if scan_id not in scans:
        return jsonify({"error": "Scan not found"}), 404
    
    scan = scans[scan_id]
    
    # Add elapsed time if still running
    if scan.get("status") == "running" and scan.get("started_at"):
        elapsed = (datetime.now() - datetime.fromisoformat(scan["started_at"])).total_seconds()
        scan["elapsed_seconds"] = int(elapsed)
    
    return jsonify(scan)


@app.route("/scan/<scan_id>/cancel", methods=["POST"])
def cancel_scan(scan_id):
    """Cancel a running scan."""
    if scan_id not in scans:
        return jsonify({"error": "Scan not found"}), 404
    
    if scans[scan_id].get("status") != "running":
        return jsonify({"error": "Scan is not running"}), 400
    
    cancel_flags[scan_id] = True
    scans[scan_id]["progress_message"] = "Cancelling..."
    
    return jsonify({"status": "cancelling", "scan_id": scan_id})


@app.route("/scans")
def list_scans():
    """List all scans with their status and progress."""
    scan_list = []
    for sid, s in sorted(scans.items(), key=lambda x: x[1].get("created_at", ""), reverse=True):
        scan_list.append({
            "id": sid,
            "target": s.get("target"),
            "scan_type": s.get("scan_type"),
            "status": s.get("status"),
            "host_count": s.get("host_count", 0),
            "progress": s.get("progress", 0),
            "progress_message": s.get("progress_message", ""),
            "hosts_scanned": s.get("hosts_scanned", 0),
            "hosts_total": s.get("hosts_total", 0),
            "created_at": s.get("created_at"),
            "completed_at": s.get("completed_at"),
            "elapsed_seconds": s.get("elapsed_seconds", 0),
        })
    return jsonify({"scans": scan_list})


@app.route("/quick/<ip>")
def quick_scan(ip):
    """
    Synchronous quick scan of a single host.
    Returns immediately with results (may take 10-30 seconds).
    """
    if not any(ip.startswith(prefix) for prefix in ["192.168.", "10.", "172.", "127."]):
        return jsonify({"error": "Only private IPs allowed"}), 403

    try:
        nm = nmap.PortScanner()
        nm.scan(hosts=ip, arguments="-sV -O -T4 --top-ports 20 --host-timeout 60s")

        if ip not in nm.all_hosts():
            return jsonify({"ip": ip, "state": "down", "error": "Host not found or not responding"})

        return jsonify(parse_host_result(nm, ip))

    except Exception as e:
        return jsonify({"ip": ip, "error": str(e)}), 500


@app.route("/discover/<subnet>")
def discover_subnet(subnet):
    """
    Quick ping sweep of a subnet to find live hosts.
    e.g., /discover/192.168.2.0/24
    """
    target = subnet.replace("_", "/")  # Allow URL-safe format

    if not any(target.startswith(prefix) for prefix in ["192.168.", "10.", "172."]):
        return jsonify({"error": "Only private subnets allowed"}), 403

    try:
        nm = nmap.PortScanner()
        nm.scan(hosts=target, arguments="-sn -T4")

        hosts = []
        for h in nm.all_hosts():
            host_info = {
                "ip": h,
                "hostname": nm[h].hostname() or None,
                "state": nm[h].state(),
                "mac_address": None,
                "vendor": None,
            }
            if "addresses" in nm[h] and "mac" in nm[h]["addresses"]:
                host_info["mac_address"] = nm[h]["addresses"]["mac"]
            if "vendor" in nm[h] and nm[h]["vendor"]:
                first_mac = list(nm[h]["vendor"].keys())[0]
                host_info["vendor"] = nm[h]["vendor"][first_mac]
            hosts.append(host_info)

        return jsonify({
            "subnet": target,
            "host_count": len(hosts),
            "hosts": sorted(hosts, key=lambda x: [int(p) for p in x["ip"].split(".")]),
            "command": nm.command_line(),
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── OUI Vendor Lookup ───────────────────────────────────────
# Common MAC OUI prefixes → manufacturer (covers ~90% of enterprise gear)
OUI_DB = {
    "00:1A:2B": "Ayecom Technology", "00:50:56": "VMware",
    "00:0C:29": "VMware", "00:15:5D": "Microsoft Hyper-V",
    "00:1C:42": "Parallels", "08:00:27": "VirtualBox",
    # Networking
    "00:1E:BD": "Cisco", "00:26:0A": "Cisco", "00:1B:54": "Cisco",
    "58:97:1E": "Cisco", "F8:72:EA": "Cisco", "D0:C7:89": "Cisco",
    "00:1A:A1": "Cisco", "B0:AA:77": "Cisco", "00:23:AB": "Cisco",
    "44:AD:D9": "Cisco", "E4:AA:5D": "Cisco", "00:17:95": "Cisco",
    "70:D3:79": "Cisco", "C0:67:AF": "Cisco", "68:86:A7": "Cisco",
    "28:6F:7F": "Cisco", "F0:29:29": "Cisco",
    "00:04:96": "Extreme Networks", "00:1F:45": "Enterasys",
    "EC:F4:BB": "Dell", "F8:DB:88": "Dell", "14:FE:B5": "Dell",
    "00:14:22": "Dell", "B8:2A:72": "Dell", "18:66:DA": "Dell",
    "F8:BC:12": "Dell", "34:17:EB": "Dell", "D4:AE:52": "Dell",
    # Servers / PCs
    "00:25:B5": "HP/HPE", "3C:D9:2B": "HP/HPE", "00:1A:4B": "HP/HPE",
    "B4:B5:2F": "HP/HPE", "94:57:A5": "HP/HPE", "A0:D3:C1": "HP/HPE",
    "FC:15:B4": "HP/HPE", "00:21:5A": "HP/HPE", "D8:D3:85": "HP/HPE",
    "A4:5D:36": "HP/HPE", "98:E7:F4": "HP/HPE",
    "D0:50:99": "ASRock", "04:D4:C4": "ASRock",
    "00:1E:67": "Intel", "A4:BF:01": "Intel", "3C:97:0E": "Intel",
    "F8:F2:1E": "Intel", "68:05:CA": "Intel", "48:21:0B": "Intel",
    # Surveillance
    "C0:56:E3": "HikVision", "44:19:B6": "HikVision",
    "C4:2F:90": "HikVision", "BC:AD:28": "HikVision",
    "28:57:BE": "HikVision", "A4:14:37": "HikVision",
    "54:C4:15": "HikVision", "E0:50:8B": "HikVision",
    "4C:BD:8F": "HikVision", "7C:13:2C": "HikVision",
    "00:80:F0": "Dahua", "3C:EF:8C": "Dahua", "A0:BD:1D": "Dahua",
    # Consumer / IoT
    "B8:27:EB": "Raspberry Pi", "DC:A6:32": "Raspberry Pi",
    "E4:5F:01": "Raspberry Pi",
    "00:11:32": "Synology", "00:1C:BF": "Synology",
    # Apple
    "F0:18:98": "Apple", "AC:BC:32": "Apple", "3C:22:FB": "Apple",
    "14:98:77": "Apple", "A8:60:B6": "Apple", "F8:FF:C2": "Apple",
    "38:F9:D3": "Apple", "E0:B5:2D": "Apple", "7C:D1:C3": "Apple",
    "DC:56:E7": "Apple", "A4:83:E7": "Apple", "BC:D0:74": "Apple",
    # Samsung / Android
    "00:21:19": "Samsung", "C4:73:1E": "Samsung", "10:D5:42": "Samsung",
    # Printers
    "00:1B:A9": "Brother", "00:80:77": "Brother",
    "00:00:48": "Epson", "64:EB:8C": "Epson",
    # Fortinet
    "00:09:0F": "Fortinet", "70:4C:A5": "Fortinet",
    "90:6C:AC": "Fortinet", "E8:1C:BA": "Fortinet",
    # TP-Link / Ubiquiti
    "50:C7:BF": "TP-Link", "C0:06:C3": "TP-Link",
    "F0:9F:C2": "Ubiquiti", "24:5A:4C": "Ubiquiti",
    "74:83:C2": "Ubiquiti", "80:2A:A8": "Ubiquiti",
    "FC:EC:DA": "Ubiquiti", "DC:9F:DB": "Ubiquiti",
    # MikroTik
    "00:0C:42": "MikroTik", "D4:CA:6D": "MikroTik",
    "6C:3B:6B": "MikroTik", "48:8F:5A": "MikroTik",
    "B8:69:F4": "MikroTik", "CC:2D:E0": "MikroTik",
    "74:4D:28": "MikroTik", "E4:8D:8C": "MikroTik",
}


def lookup_vendor(mac: str) -> str:
    """Look up vendor from MAC address OUI prefix."""
    if not mac:
        return None
    mac_upper = mac.upper().replace("-", ":").strip()
    prefix = mac_upper[:8]  # First 3 octets: XX:XX:XX
    return OUI_DB.get(prefix, None)


# ─── ARP Table via SNMP ─────────────────────────────────────
@app.route("/arp", methods=["GET"])
def get_arp_table():
    """
    Pull ARP table from a gateway/switch via SNMP.
    Query params:
      - gateway: IP of the device to query (default: 192.168.2.1)
      - community: SNMP community string (default: qboss)
    """
    gateway = request.args.get("gateway", "192.168.2.1")
    community = request.args.get("community", "qboss")

    try:
        # Use snmpwalk to get ipNetToMediaPhysAddress (ARP table)
        # OID: 1.3.6.1.2.1.4.22.1.2 = ipNetToMediaPhysAddress
        result = subprocess.run(
            ["snmpwalk", "-v2c", "-c", community, "-OQn", "-t", "10", "-r", "2",
             gateway, "1.3.6.1.2.1.4.22.1.2"],
            capture_output=True, text=True, timeout=30,
        )

        if result.returncode != 0 and not result.stdout:
            # Try the newer ipNetToPhysicalPhysAddress table (RFC 4293)
            result = subprocess.run(
                ["snmpwalk", "-v2c", "-c", community, "-OQn", "-t", "10", "-r", "2",
                 gateway, "1.3.6.1.2.1.4.35.1.4"],
                capture_output=True, text=True, timeout=30,
            )

        if result.returncode != 0 and not result.stdout:
            return jsonify({
                "error": f"SNMP walk failed: {result.stderr.strip()}",
                "gateway": gateway,
            }), 500

        # Parse snmpwalk output
        # Format: .1.3.6.1.2.1.4.22.1.2.<ifIndex>.<IP> = <MAC as hex string>
        entries = []
        seen_ips = set()

        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line or "=" not in line:
                continue

            try:
                oid_part, value_part = line.split("=", 1)
                oid_part = oid_part.strip()
                value_part = value_part.strip().strip('"')

                # Extract IP from OID — last 4 octets
                oid_nums = oid_part.split(".")
                if len(oid_nums) >= 4:
                    ip = ".".join(oid_nums[-4:])
                else:
                    continue

                # Clean up MAC address
                mac = value_part.strip()
                # Handle different MAC formats from snmpwalk
                if " " in mac:
                    # Format: "AA BB CC DD EE FF" or "AA:BB:CC:DD:EE:FF"
                    mac = mac.replace(" ", ":").upper()
                elif len(mac) == 12 and ":" not in mac:
                    # Format: AABBCCDDEEFF
                    mac = ":".join(mac[i:i+2] for i in range(0, 12, 2)).upper()

                # Normalize MAC to XX:XX:XX:XX:XX:XX
                mac = mac.replace("-", ":").upper().strip()

                # Skip invalid
                if not ip or ip in seen_ips or mac in ("", "00:00:00:00:00:00"):
                    continue
                # Validate IP
                try:
                    ipaddress.ip_address(ip)
                except ValueError:
                    continue

                seen_ips.add(ip)
                vendor = lookup_vendor(mac)

                entries.append({
                    "ip": ip,
                    "mac": mac,
                    "vendor": vendor,
                })
            except Exception:
                continue

        # Sort by IP
        entries.sort(key=lambda x: [int(p) for p in x["ip"].split(".")])

        return jsonify({
            "gateway": gateway,
            "count": len(entries),
            "entries": entries,
            "timestamp": datetime.utcnow().isoformat(),
        })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "SNMP query timed out", "gateway": gateway}), 504
    except Exception as e:
        return jsonify({"error": str(e), "gateway": gateway}), 500


# ─── DNS Reverse Lookups ─────────────────────────────────────
@app.route("/dns-reverse", methods=["POST"])
def dns_reverse_lookup():
    """
    Batch DNS reverse (PTR) lookups for a list of IPs.
    Body: { "ips": ["192.168.2.1", "192.168.2.2", ...] }
    Returns: { "results": { "192.168.2.1": "gateway.local", ... } }
    """
    import socket
    data = request.get_json() or {}
    ips = data.get("ips", [])

    if not ips:
        return jsonify({"error": "No IPs provided"}), 400

    results = {}
    for ip in ips[:256]:  # Cap at 256
        try:
            hostname = socket.gethostbyaddr(ip)[0]
            if hostname and hostname != ip:
                results[ip] = hostname
        except (socket.herror, socket.gaierror, OSError):
            pass

    return jsonify({
        "count": len(results),
        "results": results,
    })


if __name__ == "__main__":
    print("🔍 Nmap REST API v3 (with ARP + SNMP) starting on port 5001...")
    app.run(host="0.0.0.0", port=5001, debug=False)
