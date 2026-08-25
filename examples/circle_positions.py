#!/usr/bin/env python3

"""Publica una trayectoria circular para un robot, un objetivo por segundo."""

import argparse
import json
import math
import ssl
import time

import paho.mqtt.client as mqtt

BROKER = "mqtt.mecatronica-ibero.mx"
PORT = 443
TOPIC_TEMPLATE = "public/robot-sandbox/robot{robot}/goal"


def build_client():
    try:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"robot-circle-{int(time.time())}",
            transport="websockets",
        )
    except (AttributeError, TypeError):
        client = mqtt.Client(
            client_id=f"robot-circle-{int(time.time())}",
            transport="websockets",
        )

    client.ws_set_options(path="/")
    client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    return client


def main():
    parser = argparse.ArgumentParser(description="Trayectoria circular para un robot")
    parser.add_argument("--robot", type=int, choices=range(1, 5), default=1)
    parser.add_argument("--cx", type=float, default=0.0, help="Centro X del círculo")
    parser.add_argument("--cy", type=float, default=0.0, help="Centro Y del círculo")
    parser.add_argument("--radius", type=float, default=180.0, help="Radio en mm")
    parser.add_argument("--period", type=float, default=24.0, help="Periodo de una vuelta en segundos")
    parser.add_argument("--interval", type=float, default=1.0, help="Segundos entre objetivos")
    parser.add_argument("--loops", type=int, default=0, help="Número de vueltas; 0 = infinito")
    args = parser.parse_args()

    if args.radius <= 0 or args.period <= 0 or args.interval <= 0:
        raise SystemExit("radius, period e interval deben ser mayores que 0")

    topic = TOPIC_TEMPLATE.format(robot=args.robot)
    client = build_client()

    print(f"Conectando a wss://{BROKER}/ ...")
    client.connect(BROKER, PORT, keepalive=30)
    client.loop_start()
    time.sleep(0.8)

    omega = 2.0 * math.pi / args.period
    start = time.monotonic()
    last_index = -1

    print(
        f"Círculo R{args.robot}: centro=({args.cx:g},{args.cy:g}), "
        f"radio={args.radius:g} mm, periodo={args.period:g} s, intervalo={args.interval:g} s"
    )
    print("Ctrl+C para detener.")

    try:
        while True:
            elapsed = time.monotonic() - start
            index = int(elapsed / args.interval)
            if index == last_index:
                time.sleep(0.02)
                continue
            last_index = index

            t = index * args.interval
            if args.loops > 0 and t >= args.loops * args.period:
                break

            angle = omega * t
            x = args.cx + args.radius * math.cos(angle)
            y = args.cy + args.radius * math.sin(angle)
            payload = json.dumps({"x": round(x, 2), "y": round(y, 2)})

            info = client.publish(topic, payload, qos=0, retain=False)
            info.wait_for_publish()
            print(f"t={t:6.1f}s -> {payload}")
    except KeyboardInterrupt:
        print("\nDetenido por usuario.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
