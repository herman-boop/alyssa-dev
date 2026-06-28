#!/usr/bin/env python3
"""Create recommended MongoDB indexes for Alyssa Driver Checkpoint v1.0.
Idempotent — safe to run multiple times. Reads MONGO_URL + DB_NAME from backend/.env.
"""
import asyncio
import os
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "backend" / ".env")


async def main() -> None:
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]

    print(f"[indexes] Connecting to {os.environ['DB_NAME']}...")

    # trips collection
    await db.trips.create_index("trip_id", unique=True, name="trip_id_unique")
    await db.trips.create_index([("created_at", -1)], name="created_at_desc")
    await db.trips.create_index([("daily_checkpoints.date", -1)], name="daily_date_desc")
    print("[indexes] trips: trip_id_unique, created_at_desc, daily_date_desc")

    # orders collection
    await db.orders.create_index("order_id", unique=True, name="order_id_unique")
    await db.orders.create_index([("created_at", -1)], name="orders_created_desc")
    await db.orders.create_index([("status", 1), ("created_at", -1)], name="status_created")
    await db.orders.create_index("trip_id", sparse=True, name="trip_id_sparse")
    print("[indexes] orders: order_id_unique, created_desc, status_created, trip_id_sparse")

    # Show summary
    print("\n[indexes] Summary:")
    for coll in ("trips", "orders"):
        idx = await db[coll].index_information()
        print(f"  {coll}:")
        for name in idx:
            print(f"    - {name}")

    print("\n[indexes] DONE. All indexes created/verified.")


if __name__ == "__main__":
    asyncio.run(main())
