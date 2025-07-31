import asyncio
from typing import Dict, List

import uvicorn
from fastapi import FastAPI, HTTPException
import traceroot
from traceroot.integrations.fastapi import connect_fastapi
from traceroot.logger import get_logger

logger = get_logger()

# Create FastAPI app
app = FastAPI(title="Simple TraceRoot FastAPI Example")

# Connect TraceRoot to FastAPI
connect_fastapi(app)


traceroot.trace()
def calculate_sum(numbers: List[int]) -> int:
    """Calculate sum of numbers with tracing"""
    logger.info(f"Calculating sum of {len(numbers)} numbers")
    result = sum(numbers)
    logger.info(f"Sum calculated: {result}")
    return result


traceroot.trace()
async def process_data_async(data: List[int]) -> Dict[str, int]:
    """Process data asynchronously with tracing"""
    logger.info("Starting async data processing")

    # Simulate some async work
    await asyncio.sleep(0.1)

    total = calculate_sum(data)
    average = total / len(data) if data else 0
    result = {"total": total, "average": int(average), "count": len(data)}
    logger.info(f"Data processing completed: {result}")
    return result


traceroot.trace()
def validate_input(numbers: List[int]) -> bool:
    """Validate input numbers"""
    logger.info("Validating input data")

    if not numbers:
        logger.warning("Empty input provided")
        return False

    if any(n < 0 for n in numbers):
        logger.warning("Negative numbers found in input")
        return False

    logger.info("Input validation passed")
    return True


@app.post("/calculate")
async def calculate_endpoint(numbers: List[int]):
    """Calculate sum and average of provided numbers"""
    logger.info(f"Calculate endpoint called with {len(numbers)} numbers")

    try:
        # Validate input
        if not validate_input(numbers):
            raise HTTPException(
                status_code=400,
                detail="Invalid input: empty list or negative numbers")

        # Process data
        result = await process_data_async(numbers)

        logger.info("Calculation completed successfully")
        return {"status": "success", "data": result}

    except Exception as e:
        logger.error(f"Error in calculation: {str(e)}")
        raise HTTPException(status_code=500,
                            detail=f"Calculation failed: {str(e)}")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9999)
