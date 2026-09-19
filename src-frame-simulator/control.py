"""Local simulator operator. Uses only Python's standard library."""
import argparse
import http.client
import ipaddress
import json
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("action", choices=["arm", "approve", "deny", "timeout", "approve_and_drop", "append_duplicates", "scenario", "steamvr", "offline", "online", "disconnect", "reset", "state", "discovery", "register"])
parser.add_argument("value", nargs="?")
parser.add_argument("--port", type=int, default=32000)
parser.add_argument("--address", default="127.0.0.1")
args = parser.parse_args()
if not ipaddress.IPv4Address(args.address).is_loopback:
    parser.error("only loopback IPv4 addresses are allowed")
body = {"action": args.action}
if args.action == "arm":
    body["timeout_ms"] = int(args.value or 30000)
elif args.action == "scenario":
    body["name"] = args.value
elif args.action == "append_duplicates":
    if args.value not in ["on", "off"]:
        parser.error("append_duplicates requires on or off")
    body["enabled"] = args.value == "on"
elif args.action == "steamvr":
    if args.value not in ["ready", "unavailable"]:
        parser.error("steamvr requires ready or unavailable")
    body["ready"] = args.value == "ready"
path = "/__sim/control"
data = json.dumps(body).encode()
if args.action in ["state", "discovery"]:
    path = "/__sim/" + args.action
    data = None
elif args.action == "register":
    from pathlib import Path
    path = "/register"
    data = Path(args.value or Path(__file__).parent / "fixtures/client.pub").read_bytes()
request = urllib.request.Request("http://" + args.address + ":" + str(args.port) + path, data=data,
    headers={"Authorization": "Bearer DISPOSABLE-LOCAL-OPERATOR-CREDENTIAL-ONLY", "Content-Type": "application/json"})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    with opener.open(request, timeout=35) as result:
        print(result.status, result.read().decode())
except urllib.error.HTTPError as error:
    print(error.code, error.read().decode())
    raise SystemExit(1)
except (OSError, http.client.HTTPException):
    print("Connection lost. Registration may have succeeded; inspect simulator state before retrying.")
    raise SystemExit(2)
