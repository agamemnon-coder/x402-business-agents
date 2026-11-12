#!/usr/bin/env python3
# Runs a command in a fresh network namespace with only the loopback interface up: no packet can leave the machine.
# Usage: unshare -n python3 spike/do/nonet.py <command...>   (the spike's rule: no network calls of any kind)
import fcntl, os, socket, struct, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
flags = struct.unpack("16sH", fcntl.ioctl(s, 0x8913, struct.pack("16sH", b"lo", 0)))[1]  # SIOCGIFFLAGS
fcntl.ioctl(s, 0x8914, struct.pack("16sH", b"lo", flags | 1))  # SIOCSIFFLAGS, IFF_UP
s.close()
os.execvp(sys.argv[1], sys.argv[1:])
