FROM node:14-alpine

# Create app directory
WORKDIR /usr/src/app
COPY package*.json ./

# Install app dependencies
RUN npm install --silent

# Copy application source code
COPY . .
EXPOSE 8787

# Start the application
CMD [ "npm", "start" ]