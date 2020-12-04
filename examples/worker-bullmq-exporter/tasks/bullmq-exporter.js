const { Queue } = require('bullmq');

const defaultQueueName = 'database-events';
const queueName = process.env.QUEUE_NAME || defaultQueueName;

const defaultTaskName = 'database-event';
const taskName = process.env.TASK_NAME || defaultTaskName;

const host = process.env.REDIS_HOST;
const port = Number(process.env.REDIS_PORT);
const password = process.env.REDIS_PASSWORD;
const prefix = process.env.QUEUE_PREFIX;

if (queueName === defaultQueueName) {
    console.warn(`QUEUE_NAME is not defined. Defaulting to "${queueName}".`);
}
if (taskName === defaultTaskName) {
    console.warn(`TASK_NAME is not defined. Defaulting to "${taskName}".`);
}
if (!host) {
    throw new Error('REDIS_HOST is not defined.');
}
if (!port) {
    throw new Error('REDIS_PORT is not defined.');
}
if (!password) {
    throw new Error('REDIS_PASSWORD is not defined.');
}
if (!prefix) {
    throw new Error('QUEUE_PREFIX is not defined.');
}

const queue = new Queue(queueName, {
    connection: {
        host,
        port,
        password
    },
    prefix
});

const task = async (payload, helpers) => {
    const bullTask = await queue.add(taskName, payload);
    helpers.logger.info(`Scheduled ${prefix}/${queueName}/${bullTask.id}`);
};

export default task;
