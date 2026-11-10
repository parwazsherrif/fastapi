# start from a small computer that has python 3.12
FROM python:3.12-slim

# work inside the /app folder
WORKDIR /app


# install the packages first
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


# copy our code
COPY . .

# strt the api (0.0.0.0=reachable from outside the container)
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]
