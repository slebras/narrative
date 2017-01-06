import unittest
import mock
import biokbase.narrative.jobs.jobmanager
from biokbase.narrative.jobs.job import Job
import ConfigParser
import os
from util import read_json_file
import datetime
from IPython.display import HTML
"""
Tests for job management
"""
__author__ = "Bill Riehl <wjriehl@lbl.gov>"

config = ConfigParser.ConfigParser()
config.read('test.cfg')
job_info = read_json_file(config.get('jobs', 'job_info_file'))


class MockComm(object):
    """
    Mock class for ipython.kernel.Comm
    This keeps the last message that was sent, so it can be retrieved and
    analyzed during the test.
    """
    def __init__(self, *args, **kwargs):
        """Mock the init"""
        self.last_message = None

    def on_msg(self, *args, **kwargs):
        """Mock the msg router"""
        pass

    def send(self, data=None, content=None):
        """Mock sending a msg"""
        self.last_message = {"data": data, "content": content}


class MockAllClients(object):
    """
    Mock KBase service clients as needed for JobManager tests. This covers all of them,
    just need to add more methods as needed.
    """
    def list_jobs2(self, params):
        return job_info.get('job_info')

    def delete_job(self, job):
        return "bar"

    def cancel_job(self, job_id):
        return "done"

    def get_job_params(self, job_id):
        return [job_info.get('job_param_info', {}).get(job_id, None)]

    def check_job(self, job_id):
        return job_info.get('job_status_info', {}).get(job_id, None)

    def list_methods_spec(self, params):
        return read_json_file(config.get('specs', 'app_specs_file'))

    def list_categories(self, params):
        return read_json_file(config.get('specs', 'type_specs_file'))


def get_mock_client(client_name):
    return MockAllClients()


@mock.patch('biokbase.narrative.jobs.job.clients.get', get_mock_client)
def phony_job():
    return Job.from_state('phony_job',
                          {'params': [], 'service_ver': '0.0.0'},
                          'kbasetest',
                          'Test/test')


def create_jm_message(r_type, job_id=None, data={}):
    data['request_type'] = r_type
    data['job_id'] = job_id
    return {
        "content": {
            "data": data
        }
    }


class JobManagerTest(unittest.TestCase):
    @classmethod
    @mock.patch('biokbase.narrative.jobs.jobmanager.Comm', MockComm)
    @mock.patch('biokbase.narrative.jobs.jobmanager.clients.get', get_mock_client)
    def setUpClass(self):
        self.jm = biokbase.narrative.jobs.jobmanager.JobManager()
        self.jm._comm = MockComm()
        self.job_ids = job_info.get('job_param_info', {}).keys()
        os.environ['KB_WORKSPACE_ID'] = config.get('jobs', 'job_test_wsname')

        self.jm.initialize_jobs(start_lookup_thread=False)

    def validate_status_message(self, msg):
        core_keys = set(['widget_info', 'owner', 'state', 'spec'])
        state_keys = set(['app_id', 'canceled', 'cell_id', 'creation_time', 'exec_start_time', 'finished', 'job_id', 'job_state', 'owner', 'run_id', 'run_time', 'status'])
        if not core_keys.issubset(set(msg.keys())):
            return False
        if not state_keys.issubset(set(msg['state'].keys())):
            return False
        return True

    def test_send_comm_msg(self):
        self.jm._send_comm_message('foo', 'bar')

    def test_get_job_good(self):
        job_id = self.job_ids[0]
        job = self.jm.get_job(job_id)
        self.assertEqual(job_id, job.job_id)

    def test_get_job_bad(self):
        with self.assertRaises(ValueError):
            self.jm.get_job('not_a_job_id')

    def test_get_jobs_list(self):
        running_jobs = self.jm.get_jobs_list()
        self.assertIsInstance(running_jobs, list)

    def test_list_jobs_html(self):
        jobs_html = self.jm.list_jobs()
        self.assertIsInstance(jobs_html, HTML)

    @mock.patch('biokbase.narrative.jobs.jobmanager.clients.get', get_mock_client)
    def test_cancel_job_good(self):
        new_job = phony_job()
        job_id = new_job.job_id
        self.jm.register_new_job(new_job)
        self.jm.cancel_job(job_id)

    def test_cancel_job_bad(self):
        with self.assertRaises(ValueError):
            self.jm.cancel_job(None)

    def test_job_status_control(self):
        self.jm._handle_comm_message(create_jm_message("start_update_loop"))
        self.jm._handle_comm_message(create_jm_message("stop_update_loop"))

    def test_job_status_fetching(self):
        self.jm._handle_comm_message(create_jm_message("all_status"))
        msg = self.jm._comm.last_message
        job_data = msg.get('data', {}).get('content', {})
        job_ids = job_data.keys()
        # assert that each job info that's flagged for lookup gets returned
        jobs_to_lookup = [j for j in self.jm._running_jobs.keys() if self.jm._running_jobs[j]['refresh']]
        self.assertItemsEqual(job_ids, jobs_to_lookup)

    def test_single_job_status_fetch(self):
        self.jm._handle_comm_message(create_jm_message("job_status", "phony_job"))
        msg = self.jm._comm.last_message
        self.assertEquals(msg['data']['msg_type'], "job_status")
        self.assertTrue(self.validate_status_message(msg['data']['content']))

    # Should "fail" silently.
    # TODO: make a test listener for the other half of the comm channel, and test against that.
    def test_job_message_bad_id(self):
        self.jm._handle_comm_message(create_jm_message("foo", job_id="not_a_real_job"))

if __name__ == "__main__":
    unittest.main()
