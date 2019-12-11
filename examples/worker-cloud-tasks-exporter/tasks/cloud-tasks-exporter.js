const { CloudTasksClient } = require('@google-cloud/tasks')

const client = new CloudTasksClient()

// TODO(developer) configure your queue
const project = 'your-gcp-project'
const location = 'your-app-engine-location'
const queue = 'your-queue-name'

// Construct the fully qualified queue name.
const parent = client.queuePath(project, location, queue)

async function createTask ({
  logger,
  endpoint,
  payload,
  delay,
  service = 'default',
  httpMethod = 'POST'
}) {
  // For details on how to create a Task Object check
  // https://googleapis.dev/nodejs/tasks/latest/google.cloud.tasks.v2beta2.html#.Task
  const task = {
    appEngineHttpRequest: {
      httpMethod,
      relativeUri: `/${endpoint}`,
      appEngineRouting: {
        service
      }
    }
  }

  if (payload) {
    if (typeof payload === 'object') {
      payload = JSON.stringify(payload)
    }
    task.appEngineHttpRequest.body = Buffer.from(payload).toString('base64')
  }

  if (delay) {
    // The time when the task is scheduled to be attempted.
    task.scheduleTime = {
      seconds: delay + Date.now() / 1000
    }
  }

  // Send create task request.
  logger.info('Sending task')

  const request = { parent, task }
  const [response] = await client.createTask(request)
  const name = response.name

  logger.info(`Created task ${name}`)

  return name
}

// Graphile Worker Task
module.exports = async (payload, { logger }) => {
  logger.info(
    `Delegating task to Cloud Tasks with payload ${JSON.stringify(payload)}`
  )

  await createTask({
    endpoint: 'your-task-endpoint',
    payload,
    logger
  })

  logger.info('Done!')
}